#!/usr/bin/env node
/**
 * Sync Linear issues to compliance dashboard HTML.
 * Requires: LINEAR_API_KEY in environment.
 * Usage: LINEAR_API_KEY=your_key node sync-linear-to-dashboard.js
 */

const fs = require('fs');
const path = require('path');

const LINEAR_API = 'https://api.linear.app/graphql';
const API_KEY = process.env.LINEAR_API_KEY;
const HTML_FILE = path.join(__dirname, 'compliance_dashboard_v14_roxom (1).html');

const PRIORITY_MAP = { 0: 'None', 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low' };
const SHIRT_LABELS = ['XS', 'S', 'M', 'L', 'XL'];
// Open = only these statuses (sum of Backlog + Todo + In Progress + In Review + On Hold) - excludes Pending Signature (PGA label)
const OPEN_STATUSES = ['Backlog', 'Todo', 'In Progress', 'In Review', 'On Hold'];
// PGA performance: custom status mapping (done = on going, ended; open = backlog, todo, in progress, pending signature)
const PGA_OPEN_STATUSES = ['Backlog', 'Todo', 'In Progress', 'Pending Signature'];
const PGA_CLOSED_STATUSES = ['On Going', 'Ongoing', 'Ended'];

function isPgaOpen(row) {
  const s = (row.state || '').trim();
  return PGA_OPEN_STATUSES.some(open => open.toLowerCase() === s.toLowerCase());
}
function isPgaClosed(row) {
  const s = (row.state || '').trim();
  return PGA_CLOSED_STATUSES.some(closed => closed.toLowerCase() === s.toLowerCase());
}
// Estados que no deben contarse en ninguna card (open, closed, by person, etc.). Incluye trashed/para restaurar.
const ELIMINATED_STATES = ['Canceled', 'Duplicate', 'Deleted', 'Archived', 'Trashed'];
function isEliminatedState(state) {
  if (!state || typeof state !== 'string') return false;
  const s = state.toLowerCase();
  if (ELIMINATED_STATES.some(e => e.toLowerCase() === s)) return true;
  if (s.includes('delete') || s.includes('trash') || s.includes('restore')) return true;
  return false;
}
const MAIN_TEAMS = ['Comp-leg', 'FCP', 'LTO', 'RPA']; // All = sum of these 4 (excludes PGA)
const PRIORITY_ORDER = ['Urgent', 'High', 'Medium', 'Low', 'None']; // fixed order so By Priority chart always shows labels in All tab
// Display name for assignees (Linear name → dashboard label)
const ASSIGNEE_DISPLAY_NAMES = { sofita: 'Sofia' };
function assigneeDisplayName(name) {
  if (!name) return 'Unassigned';
  return ASSIGNEE_DISPLAY_NAMES[name] || ASSIGNEE_DISPLAY_NAMES[name.toLowerCase()] || name;
}

function linearRequest(query, variables = {}) {
  return fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  }).then(r => r.json());
}

async function fetchAllIssues() {
  const issues = [];
  let cursor = null;
  const query = `
    query Issues($first: Int!, $after: String) {
      issues(first: $first, after: $after) {
        nodes {
          id
          identifier
          title
          url
          dueDate
          createdAt
          updatedAt
          completedAt
          trashed
          priority
          state { name type }
          team { key name id }
          assignee { name }
          labels { nodes { name } }
          project { id name slugId }
          parent { id }
          children {
            nodes {
              id
              identifier
              title
              url
              state { name }
              assignee { name }
              priority
              project { name }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
  do {
    const res = await linearRequest(query, { first: 100, after: cursor });
    if (res.errors) throw new Error(JSON.stringify(res.errors));
    const data = res.data.issues;
    issues.push(...data.nodes);
    cursor = data.pageInfo.hasNextPage ? data.pageInfo.endCursor : null;
  } while (cursor);
  return issues;
}

const TEAM_NAME_MAP = {
  'Comp-leg': 'Comp-leg',
  'Financial Crime Prevention': 'FCP',
  'Legal Tech Operations': 'LTO',
  'Regulatory and Public Affairs': 'RPA',
  'Regulatory Public Affairs': 'RPA',
  'PGA': 'PGA',
};

// Assignee → team for dashboard: issues assigned to these people count for that team (e.g. yani/yanina → FCP).
const ASSIGNEE_TO_TEAM = {
  'yanina acosta': 'FCP', 'yani': 'FCP', 'yanina': 'FCP',
  'guadalupe assorati': 'LTO', 'guadalupe': 'LTO',
  'pasto': 'LTO',
  'sofita': 'RPA', 'sofia': 'RPA',
  'alfonso martel seward': 'RPA', 'alfonso martel': 'RPA',
};
function getDashboardTeam(row) {
  const assigneeNorm = (row.assignee || '').toLowerCase().trim();
  if (ASSIGNEE_TO_TEAM[assigneeNorm]) return ASSIGNEE_TO_TEAM[assigneeNorm];
  const team = row.team;
  return MAIN_TEAMS.includes(team) || team === 'PGA' ? team : (TEAM_NAME_MAP[team] || team);
}

/** For DKR parent issues: team from parent assignee, or from first child with ASSIGNEE_TO_TEAM (so yani's sub-issues count for FCP). */
function getDkrDashboardTeam(dkrRow) {
  const fromParent = getDashboardTeam(dkrRow);
  if (MAIN_TEAMS.includes(fromParent)) return fromParent;
  const children = dkrRow.children || [];
  for (const c of children) {
    const assigneeNorm = (c.assignee || '').toLowerCase().trim();
    if (ASSIGNEE_TO_TEAM[assigneeNorm]) return ASSIGNEE_TO_TEAM[assigneeNorm];
  }
  return fromParent;
}

function normalizeTeam(teamName, teamKey) {
  if (TEAM_NAME_MAP[teamName]) return TEAM_NAME_MAP[teamName];
  if (teamKey && ['Comp-leg', 'FCP', 'LTO', 'RPA', 'PGA'].includes(teamKey)) return teamKey;
  return teamName || 'Unknown';
}

function toIssueRow(i) {
  const teamName = i.team?.name || '';
  const teamKey = i.team?.key || '';
  const team = normalizeTeam(teamName, teamKey);
  const assignee = assigneeDisplayName(i.assignee?.name);
  const priority = PRIORITY_MAP[i.priority] ?? 'None';
  const labels = (i.labels?.nodes || []).map(l => l.name);
  
  // Find shirt size: look for "Shirt Size: XS" or just "XS" in labels (case insensitive)
  let shirtSize = 'Missing';
  for (const size of SHIRT_LABELS) {
    if (labels.some(l => {
      const labelLower = (l || '').toLowerCase();
      return labelLower.includes(`shirt size: ${size.toLowerCase()}`) || 
             labelLower === size.toLowerCase() ||
             labelLower.includes(`: ${size.toLowerCase()}`);
    })) {
      shirtSize = size;
      break;
    }
  }
  
  // Fallback to estimate if no shirt size label found
  if (shirtSize === 'Missing' && i.estimate != null) {
    const e = i.estimate;
    if (e <= 1) shirtSize = 'XS';
    else if (e <= 2) shirtSize = 'S';
    else if (e <= 3) shirtSize = 'M';
    else if (e <= 5) shirtSize = 'L';
    else shirtSize = 'XL';
  }
  
  const project = i.project ? { id: i.project.id, name: i.project.name, slugId: i.project.slugId } : null;
  const projectUrl = project?.slugId ? `https://linear.app/roxom/project/${project.slugId}` : null;
  const childNodes = i.children?.nodes || [];
  const children = childNodes.map(c => ({
    id: c.identifier,
    title: c.title,
    team,
    assignee: assigneeDisplayName(c.assignee?.name),
    priority: PRIORITY_MAP[c.priority] ?? 'None',
    url: c.url || `https://linear.app/roxom/issue/${c.identifier}`,
    state: c.state?.name || 'Unknown',
    projectName: c.project?.name || null,
  }));
  const dashboardTeam = getDashboardTeam({ team, assignee });
  const group = getGroup(labels); // "Group: Roxom Global" → Global, "Group: Roxom TV" → Roxom TV, "Group: Roxom" → Roxom
  return {
    id: i.identifier,
    title: i.title,
    team,
    assignee,
    dashboardTeam,
    group,
    priority,
    url: i.url || `https://linear.app/roxom/issue/${i.identifier}`,
    state: i.state?.name || 'Unknown',
    dueDate: i.dueDate,
    createdAt: i.createdAt,
    completedAt: i.completedAt,
    trashed: !!i.trashed,
    shirtSize,
    labels,
    project: project?.name || null,
    projectUrl: projectUrl || null,
    parentId: i.parent?.id || null,
    children,
  };
}

function getGroup(labels) {
  const arr = Array.isArray(labels) ? labels : [];
  // "Group: Roxom Global" = holding/global → Global (debe ir primero para no confundir con "Group: Roxom")
  const hasRoxomGlobal = arr.some(l => {
    const s = (l && (typeof l === 'string' ? l : String(l))).toString().toLowerCase().trim();
    return s === 'group: roxom global' || s.includes('roxom global');
  });
  if (hasRoxomGlobal) return 'Global';
  const hasRoxomTV = arr.some(l => {
    const s = (l && (typeof l === 'string' ? l : String(l))).toString().toLowerCase().trim();
    return s.includes('roxom tv') || s === 'group: roxom tv';
  });
  if (hasRoxomTV) return 'Roxom TV';
  const hasRoxom = arr.some(l => {
    const s = (l && (typeof l === 'string' ? l : String(l))).toString().toLowerCase().trim();
    return (s.includes('group') && s.includes('roxom') && !s.includes('roxom tv') && !s.includes('roxom global')) || s === 'roxom';
  });
  if (hasRoxom) return 'Roxom';
  return null;
}

function daysBetween(d1, d2) {
  const a = new Date(d1);
  const b = new Date(d2);
  return Math.floor((b - a) / (24 * 60 * 60 * 1000));
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

function inLastNWeeks(completedAt, nWeeks) {
  if (!completedAt) return false;
  const t = new Date(completedAt).getTime();
  const cutoff = Date.now() - nWeeks * MS_PER_WEEK;
  return t >= cutoff;
}

function inPrev4Weeks(completedAt) {
  if (!completedAt) return false;
  const t = new Date(completedAt).getTime();
  const now = Date.now();
  return t >= now - 8 * MS_PER_WEEK && t < now - 4 * MS_PER_WEEK;
}

function getISOWeekKey(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  const y = monday.getFullYear();
  const jan1 = new Date(y, 0, 1);
  const w = Math.ceil((((monday - jan1) / MS_PER_DAY) + jan1.getDay() + 1) / 7);
  return { key: `${y}-W${String(w).padStart(2, '0')}`, weekNum: w, year: y, monday: monday.toISOString().slice(0, 10) };
}

function getLast11WeekKeys() {
  const out = [];
  const now = new Date();
  const currentWeek = getISOWeekKey(now.toISOString());
  if (!currentWeek) return out;
  const monday = new Date(currentWeek.monday);
  for (let i = 0; i < 11; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() - 7 * (10 - i));
    const info = getISOWeekKey(d.toISOString());
    if (info) out.push({ key: info.key.length >= 6 ? info.key.slice(2) : info.key, weekNum: info.weekNum, year: info.year, weekStart: info.monday });
  }
  return out;
}

function buildDashboardData(issues) {
  const rows = issues.map(toIssueRow);
  // NINGUNA métrica debe incluir issues eliminadas: trashed, estado Deleted/Canceled/Duplicate/Archived/Trashed, ni sin asignar.
  // rowsActive = única base para open/closed/byTeam/byAssignee/velocity/SLA/cycleTime/weeklyData/qualityData/OKR.
  // canceled/duplicated excluyen trashed. deletedIssueIds = IDs excluidas para el sidebar del dashboard.
  const rowsActive = rows.filter(r => {
    if (r.trashed) return false;
    if (isEliminatedState(r.state)) return false;
    if (r.assignee === 'Unassigned') return false;
    return true;
  });
  // IDs excluidas (trashed/eliminated/unassigned) para que el dashboard las filtre al hacer click en barras
  const deletedIssueIds = rows
    .filter(r => r.trashed || isEliminatedState(r.state) || r.assignee === 'Unassigned')
    .map(r => r.id);
  const today = new Date().toISOString().slice(0, 10);
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Open = only Backlog + Todo + In Progress + In Review + On Hold (excludes Pending Signature - PGA label). Sin eliminated.
  const open = rowsActive.filter(r => r.state && OPEN_STATUSES.includes(r.state));
  // Closed = only Done (exclude Canceled, Ongoing, Ended). Sin eliminated.
  const closed = rowsActive.filter(r => r.state === 'Done');
  // Canceled and Duplicated: solo para las cards de reconciliación; excluir trashed para que no entren en ninguna métrica
  const canceled = rows.filter(r => r.state === 'Canceled' && !r.trashed);
  const duplicated = rows.filter(r => r.state === 'Duplicate' && !r.trashed);
  const overdue = open.filter(r => r.dueDate && r.dueDate < today);
  const dueSoon = open.filter(r => r.dueDate && r.dueDate >= today && r.dueDate <= in7Days);
  // For "All" view: include ALL teams (Comp-leg, FCP, LTO, RPA, PGA) - total should match Linear
  const ALL_TEAMS = [...MAIN_TEAMS, 'PGA'];
  const openForAll = open.filter(r => ALL_TEAMS.includes(r.team));
  const canceledForAll = canceled.filter(r => ALL_TEAMS.includes(r.team));
  const duplicatedForAll = duplicated.filter(r => ALL_TEAMS.includes(r.team));
  const noDueDate = openForAll.filter(r => !r.dueDate).length;
  const unassigned = openForAll.filter(r => r.assignee === 'Unassigned').length;

  const byStatus = {};
  openForAll.forEach(r => {
    const s = r.state || 'Backlog';
    if (!byStatus[s]) byStatus[s] = [];
    byStatus[s].push({ id: r.id, title: r.title, team: r.team, assignee: r.assignee, priority: r.priority, url: r.url, state: r.state });
  });

  const byPriority = {};
  openForAll.forEach(r => {
    const p = r.priority || 'None';
    if (!byPriority[p]) byPriority[p] = [];
    byPriority[p].push({ id: r.id, title: r.title, team: r.team, assignee: r.assignee, priority: r.priority, url: r.url, state: r.state });
  });

  const byTeam = {};
  MAIN_TEAMS.forEach(t => {
    const teamOpen = open.filter(r => r.team === t);
    const teamClosed = closed.filter(r => r.team === t);
    const teamClosedIn10Weeks = teamClosed.filter(r => inLastNWeeks(r.completedAt, 10));
    const teamOverdue = overdue.filter(r => r.team === t);

    // Avg cycle time (días): promedio creación → cierre para cerrados con fechas
    let avgCycleTime = null;
    const teamWithDates = teamClosed.filter(r => r.createdAt && r.completedAt);
    if (teamWithDates.length > 0) {
      const totalResolutionTime = teamWithDates.reduce((sum, r) => sum + daysBetween(r.createdAt, r.completedAt), 0);
      avgCycleTime = Number((totalResolutionTime / teamWithDates.length).toFixed(2));
    }
    // SLA (%): % de cerrados con due date que se cerraron a tiempo
    const teamClosedWithDue = teamClosed.filter(r => r.dueDate && r.completedAt);
    const teamClosedOnTime = teamClosedWithDue.filter(r => r.completedAt.slice(0, 10) <= r.dueDate.slice(0, 10));
    const slaPct = teamClosedWithDue.length > 0 ? Math.round((teamClosedOnTime.length / teamClosedWithDue.length) * 100) : null;

    byTeam[t] = {
      team: t,
      open: teamOpen.length,
      closed: teamClosed.length,
      overdue: teamOverdue.length,
      velocity: (teamClosedIn10Weeks.length / 10).toFixed(1),
      closedWithDueDate: teamClosedWithDue.length,
      closedOnTime: teamClosedOnTime.length,
      sla: slaPct,
      avgCycleTime,
    };
  });
  const teams = [...MAIN_TEAMS];
  // Add PGA if present in data (for teamDetailedData only; not in summaryStats.byTeam)
  const allTeamKeys = [...new Set(rowsActive.map(r => r.team))].filter(t => t && t !== 'Unknown');
  if (allTeamKeys.includes('PGA')) {
    // PGA performance: done = On Going, Ended; open = Backlog, Todo, In Progress, Pending Signature (sin eliminated)
    const teamOpen = rowsActive.filter(r => r.team === 'PGA' && isPgaOpen(r));
    const teamClosed = rowsActive.filter(r => r.team === 'PGA' && isPgaClosed(r));
    const teamClosedIn10Weeks = teamClosed.filter(r => inLastNWeeks(r.completedAt, 10));
    const pgaOverdue = teamOpen.filter(r => r.dueDate && r.dueDate < today);

    let pgaAvgCycleTime = null;
    const pgaWithDates = teamClosed.filter(r => r.createdAt && r.completedAt);
    if (pgaWithDates.length > 0) {
      const totalResolutionTime = pgaWithDates.reduce((sum, r) => sum + daysBetween(r.createdAt, r.completedAt), 0);
      pgaAvgCycleTime = Number((totalResolutionTime / pgaWithDates.length).toFixed(2));
    }
    const pgaClosedWithDue = teamClosed.filter(r => r.dueDate && r.completedAt);
    const pgaClosedOnTime = pgaClosedWithDue.filter(r => r.completedAt.slice(0, 10) <= r.dueDate.slice(0, 10));
    const pgaSlaPct = pgaClosedWithDue.length > 0 ? Math.round((pgaClosedOnTime.length / pgaClosedWithDue.length) * 100) : null;

    byTeam['PGA'] = { team: 'PGA', open: teamOpen.length, closed: teamClosed.length, overdue: pgaOverdue.length, velocity: (teamClosedIn10Weeks.length / 10).toFixed(1), closedWithDueDate: pgaClosedWithDue.length, closedOnTime: pgaClosedOnTime.length, sla: pgaSlaPct, avgCycleTime: pgaAvgCycleTime };
  }

  const byAssignee = {};
  // For byAssignee, exclude PGA (only count MAIN_TEAMS) to match other metrics
  const openForAssignee = open.filter(r => MAIN_TEAMS.includes(r.team));
  const assignees = [...new Set(openForAssignee.map(r => r.assignee))].filter(a => a && a !== 'Unassigned');
  const weightMap = { XS: 1, S: 2, M: 3, L: 5, XL: 8, Missing: 0 };
  assignees.forEach(a => {
    const personOpen = openForAssignee.filter(r => r.assignee === a);
    const personOverdue = overdue.filter(r => r.assignee === a && MAIN_TEAMS.includes(r.team));
    const weighted = personOpen.reduce((sum, r) => sum + (weightMap[r.shirtSize] ?? 0), 0);
    byAssignee[a] = { assignee: a, open: personOpen.length, weighted, overdue: personOverdue.length };
  });

  const overdueIssues = overdue
    .filter(r => ALL_TEAMS.includes(r.team))
    .map(r => ({
      id: r.id,
      title: r.title,
      team: r.team,
      due_date: r.dueDate,
      days_overdue: r.createdAt ? daysBetween(r.createdAt, today) : (r.dueDate ? daysBetween(r.dueDate, today) : 0),
      assignee: r.assignee,
      priority: r.priority,
      url: r.url,
    }))
    .sort((a, b) => a.days_overdue - b.days_overdue);

  const dueSoonIssues = dueSoon.filter(r => ALL_TEAMS.includes(r.team)).map(r => ({
    id: r.id,
    title: r.title,
    team: r.team,
    due_date: r.dueDate,
    assignee: r.assignee,
    priority: r.priority,
    url: r.url,
  }));

  // List of all closed issues for the sidebar
  const closedIssues = closed
    .filter(r => ALL_TEAMS.includes(r.team))
    .map(r => ({
      id: r.id,
      title: r.title,
      team: r.team,
      assignee: r.assignee,
      priority: r.priority,
      url: r.url,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
    }))
    .sort((a, b) => {
      // Sort by completedAt descending (most recent first)
      if (a.completedAt && b.completedAt) {
        return new Date(b.completedAt) - new Date(a.completedAt);
      }
      return 0;
    });

  // Calculate totalOpen as sum of byStatus to ensure consistency
  const byStatusArr = Object.entries(byStatus).map(([status, list]) => ({ status, count: list.length }));
  const totalOpen = byStatusArr.reduce((sum, item) => sum + item.count, 0); // Sum of all statuses = totalOpen
  const totalClosed = closed.filter(r => ALL_TEAMS.includes(r.team)).length;
  const total = rowsActive.filter(r => ALL_TEAMS.includes(r.team)).length;
  // Fixed order so By Priority chart always shows all labels in All tab
  const byPriorityArr = PRIORITY_ORDER.map(p => ({ priority: p, count: (byPriority[p] || []).length }));

  const byShirtSize = {};
  openForAll.forEach(r => {
    const s = r.shirtSize || 'Missing';
    byShirtSize[s] = (byShirtSize[s] || 0) + 1;
  });
  const weightForSize = { XS: 1, S: 2, M: 3, L: 5, XL: 8, Missing: 0 };
  const byShirtSizeArr = ['XS', 'S', 'M', 'L', 'XL', 'Missing'].map(size => ({
    size,
    count: byShirtSize[size] || 0,
    weight: weightForSize[size] ?? 0,
  })).filter(s => s.count > 0);

  const byWorkTypeArr = [
    { type: 'OKRs', count: openForAll.filter(r => r.labels.some(l => (l || '').toLowerCase().includes('okr'))).length },
    { type: 'BAU', count: openForAll.filter(r => r.labels.some(l => (l || '').toLowerCase().includes('bau'))).length },
    { type: 'Unclassified', count: openForAll.filter(r => !r.labels.some(l => ((l || '').toLowerCase().includes('okr')) || (l || '').toLowerCase().includes('bau'))).length },
  ];

  // Cycle time = average days from creation to close (all closed with dates). SLA = % closed by due date.
  // Only include MAIN_TEAMS (Comp-leg, FCP, LTO, RPA) - exclude PGA
  const closedForSla = closed.filter(r => MAIN_TEAMS.includes(r.team));
  const closedWithDatesOnly = closedForSla.filter(r => r.createdAt && r.completedAt);
  // Velocity = issues en Done (sin PGA) en las últimas 10 semanas / 10
  const closedInLast10Weeks = closedForSla.filter(r => r.completedAt && inLastNWeeks(r.completedAt, 10));
  const closedPrev4Weeks = closedWithDatesOnly.filter(r => inPrev4Weeks(r.completedAt));
  let avgCycleTime = null;
  let avgCycleTimePrev = null;
  let slaCompliancePct = null;  // % of closed (with due date) that were closed on or before due date
  let slaCompliancePrevPct = null;
  let velocityPrev = 0;

  if (closedWithDatesOnly.length > 0) {
    const totalResolutionTime = closedWithDatesOnly.reduce((sum, r) => sum + daysBetween(r.createdAt, r.completedAt), 0);
    avgCycleTime = Number((totalResolutionTime / closedWithDatesOnly.length).toFixed(2));
  }
  if (closedPrev4Weeks.length > 0) {
    const totalPrev = closedPrev4Weeks.reduce((sum, r) => sum + daysBetween(r.createdAt, r.completedAt), 0);
    avgCycleTimePrev = Number((totalPrev / closedPrev4Weeks.length).toFixed(2));
    velocityPrev = Number((closedPrev4Weeks.length / 4).toFixed(1));
  }
  // SLA compliance: % of closed issues that had a due date and were closed on or before due date
  const closedWithDueDate = closedForSla.filter(r => r.dueDate && r.completedAt);
  const closedOnTime = closedWithDueDate.filter(r => r.completedAt.slice(0, 10) <= r.dueDate.slice(0, 10));
  if (closedWithDueDate.length > 0) {
    slaCompliancePct = Math.round((closedOnTime.length / closedWithDueDate.length) * 100);
  }
  const closedPrev4WithDue = closedPrev4Weeks.filter(r => r.dueDate);
  const closedOnTimePrev = closedPrev4WithDue.filter(r => r.completedAt.slice(0, 10) <= r.dueDate.slice(0, 10));
  if (closedPrev4WithDue.length > 0) {
    slaCompliancePrevPct = Math.round((closedOnTimePrev.length / closedPrev4WithDue.length) * 100);
  }

  // Canceled/Duplicated by team
  const canceledByTeam = {};
  const duplicatedByTeam = {};
  ALL_TEAMS.forEach(t => {
    canceledByTeam[t] = canceledForAll.filter(r => r.team === t).map(r => ({
      id: r.id,
      title: r.title,
      team: r.team,
      assignee: r.assignee,
      priority: r.priority,
      url: r.url,
    }));
    duplicatedByTeam[t] = duplicatedForAll.filter(r => r.team === t).map(r => ({
      id: r.id,
      title: r.title,
      team: r.team,
      assignee: r.assignee,
      priority: r.priority,
      url: r.url,
    }));
  });

  // Canceled/Duplicated by assignee
  const canceledByAssignee = {};
  const duplicatedByAssignee = {};
  const allAssignees = [...new Set([...canceledForAll, ...duplicatedForAll].map(r => r.assignee))];
  allAssignees.forEach(a => {
    canceledByAssignee[a] = canceledForAll.filter(r => r.assignee === a).map(r => ({
      id: r.id,
      title: r.title,
      team: r.team,
      assignee: r.assignee,
      priority: r.priority,
      url: r.url,
    }));
    duplicatedByAssignee[a] = duplicatedForAll.filter(r => r.assignee === a).map(r => ({
      id: r.id,
      title: r.title,
      team: r.team,
      assignee: r.assignee,
      priority: r.priority,
      url: r.url,
    }));
  });

  const velocityCurrent = closedInLast10Weeks.length / 10;

  const summaryStats = {
    total,
    totalOpen,
    totalClosed,
    overdue: overdueIssues.length,
    dueSoon: dueSoonIssues.length,
    noDueDate,
    unassigned,
    avgCycleTime: avgCycleTime !== null ? avgCycleTime : 0,
    avgCycleTimePrev: avgCycleTimePrev !== null ? avgCycleTimePrev : 0,
    velocity: Number(velocityCurrent.toFixed(1)),
    velocityPrev: velocityPrev,
    slaCompliance: slaCompliancePct !== null ? slaCompliancePct : null,
    slaCompliancePrev: slaCompliancePrevPct !== null ? slaCompliancePrevPct : null,
    byStatus: byStatusArr,
    byPriority: byPriorityArr,
    byShirtSize: byShirtSizeArr.length ? byShirtSizeArr : [
      { size: 'XS', count: 0, weight: 1 }, { size: 'S', count: 0, weight: 2 }, { size: 'M', count: 0, weight: 3 },
      { size: 'L', count: 0, weight: 5 }, { size: 'XL', count: 0, weight: 8 }, { size: 'Missing', count: totalOpen, weight: 0 },
    ],
    byWorkType: byWorkTypeArr,
    byTeam: ALL_TEAMS.map(t => byTeam[t]).filter(Boolean),
    byAssignee: Object.values(byAssignee),
    overdueIssues,
    dueSoonIssues,
    closedIssues,
    canceledCount: canceledForAll.length,
    duplicatedCount: duplicatedForAll.length,
    canceledByTeam,
    duplicatedByTeam,
    canceledByAssignee,
    duplicatedByAssignee,
  };

  const teamDetailedData = {};
  teams.filter(t => t !== 'PGA').forEach(teamKey => {
    const teamOpen = open.filter(r => r.team === teamKey);
    const teamOverdue = overdue.filter(r => r.team === teamKey);
    const statusCounts = {};
    teamOpen.forEach(r => { statusCounts[r.state] = (statusCounts[r.state] || 0) + 1; });
    const priorityCounts = {};
    teamOpen.forEach(r => { priorityCounts[r.priority] = (priorityCounts[r.priority] || 0) + 1; });
    
    // Group issues by shirt size for this team (use this as source of truth)
    const issuesByShirtSizeForTeam = {};
    ['XS', 'S', 'M', 'L', 'XL', 'Missing'].forEach(size => {
      issuesByShirtSizeForTeam[size] = teamOpen
        .filter(r => (r.shirtSize || 'Missing') === size)
        .map(r => ({ id: r.id, title: r.title, team: r.team, assignee: r.assignee, priority: r.priority, url: r.url, state: r.state }));
    });
    
    // Calculate shirtCounts from the actual issuesByShirtSize arrays to ensure consistency
    const shirtCounts = {};
    ['XS', 'S', 'M', 'L', 'XL', 'Missing'].forEach(size => {
      shirtCounts[size] = issuesByShirtSizeForTeam[size].length;
    });
    
    teamDetailedData[teamKey] = {
      total: teamOpen.length + closed.filter(r => r.team === teamKey).length,
      open: teamOpen.length,
      closed: closed.filter(r => r.team === teamKey).length,
      overdue: teamOverdue.length,
      byStatus: Object.entries(statusCounts).map(([status, count]) => ({ status, count })),
      byPriority: PRIORITY_ORDER.map(p => ({ priority: p, count: (priorityCounts[p] || 0) })),
      byShirtSize: Object.entries(shirtCounts).filter(([size, count]) => count > 0).map(([size, count]) => ({ size, count })),
      overdueIssues: overdueIssues.filter(i => i.team === teamKey),
      issuesByShirtSize: issuesByShirtSizeForTeam,
    };
  });

  const assigneeDetailedData = {};
  assignees.forEach(a => {
    // For assignee detailed data, exclude PGA (only count MAIN_TEAMS) to match byAssignee summary
    const personOpen = openForAssignee.filter(r => r.assignee === a);
    const personClosed = closed.filter(r => r.assignee === a && MAIN_TEAMS.includes(r.team));
    const personOverdue = overdue.filter(r => r.assignee === a && MAIN_TEAMS.includes(r.team));
    const statusCounts = {};
    personOpen.forEach(r => { statusCounts[r.state] = (statusCounts[r.state] || 0) + 1; });
    const priorityCounts = {};
    personOpen.forEach(r => { priorityCounts[r.priority] = (priorityCounts[r.priority] || 0) + 1; });
    // Group issues by shirt size for this assignee (use this as source of truth)
    const issuesByShirtSizeForAssignee = {};
    ['XS', 'S', 'M', 'L', 'XL', 'Missing'].forEach(size => {
      issuesByShirtSizeForAssignee[size] = personOpen
        .filter(r => (r.shirtSize || 'Missing') === size)
        .map(r => ({ id: r.id, title: r.title, team: r.team, assignee: r.assignee, priority: r.priority, url: r.url, state: r.state }));
    });
    
    // Calculate shirtCounts from the actual issuesByShirtSize arrays to ensure consistency
    const shirtCounts = {};
    ['XS', 'S', 'M', 'L', 'XL', 'Missing'].forEach(size => {
      shirtCounts[size] = issuesByShirtSizeForAssignee[size].length;
    });
    
    const weighted = personOpen.reduce((sum, r) => sum + (weightMap[r.shirtSize] ?? 0), 0);
    
    assigneeDetailedData[a] = {
      open: personOpen.length,
      closed: personClosed.length,
      overdue: personOverdue.length,
      weighted,
      byStatus: Object.entries(statusCounts).map(([status, count]) => ({ status, count })),
      byPriority: PRIORITY_ORDER.map(p => ({ priority: p, count: (priorityCounts[p] || 0) })),
      byShirtSize: Object.entries(shirtCounts).filter(([size, count]) => count > 0).map(([size, count]) => ({ size, count })),
      overdueIssues: overdueIssues.filter(i => i.assignee === a),
      issuesByShirtSize: issuesByShirtSizeForAssignee,
    };
  });

  const issuesByShirtSize = {};
  ['XS', 'S', 'M', 'L', 'XL', 'Missing'].forEach(size => {
    issuesByShirtSize[size] = openForAll.filter(r => (r.shirtSize || 'Missing') === size).map(r => ({ id: r.id, title: r.title, team: r.team, assignee: r.assignee, priority: r.priority, url: r.url, state: r.state }));
  });

  const okrRowToIssue = (r) => ({ id: r.id, title: r.title, team: r.team, assignee: r.assignee, priority: r.priority, url: r.url });

  const getOkrNumFromProject = (projectName) => {
    if (!projectName) return null;
    const s = String(projectName);
    if (/OKR\s*1\b/i.test(s)) return 1;
    if (/OKR\s*2\b/i.test(s)) return 2;
    if (/OKR\s*3\b/i.test(s)) return 3;
    return null;
  };

  // DKR data first: one row per top-level DKR (parentId === null, title contains "DKR").
  // Team = parent assignee or, if parent not in MAIN_TEAMS, first child assignee in ASSIGNEE_TO_TEAM (so DKR with yani's sub-issues shows under FCP).
  const dkrTitleRe = /DKR\s*(\d+)/i;
  const dkrEligible = (r) =>
    MAIN_TEAMS.includes(getDkrDashboardTeam(r)) && r.state !== 'Canceled' && r.state !== 'Duplicate' &&
    dkrTitleRe.test(r.title || '') && r.parentId == null;

  const dkrParentIssues = rowsActive.filter(dkrEligible);

  const dkrSummaryByTeam = {};
  const issuesByOKR = {};
  const dkrRowsByTeam = {}; // team -> [ { identifier, name, team, total, open, closed, completion, status, okrNum, projectName, projectUrl, list, parentState, parentAssignee, parentUrl, parentPriority } ]
  MAIN_TEAMS.forEach(t => { dkrRowsByTeam[t] = []; });

  MAIN_TEAMS.forEach(team => {
    const teamDkrs = dkrParentIssues
      .filter(r => getDkrDashboardTeam(r) === team)
      .sort((a, b) => {
        const na = (a.title || '').match(dkrTitleRe);
        const nb = (b.title || '').match(dkrTitleRe);
        const numA = na ? parseInt(na[1], 10) : 999;
        const numB = nb ? parseInt(nb[1], 10) : 999;
        return numA !== numB ? numA - numB : (a.title || '').localeCompare(b.title || '');
      });
    teamDkrs.forEach(r => {
      const children = r.children || [];
      const useChildren = children.length > 0;
      const list = useChildren ? children : [r];
      const openList = useChildren
        ? children.filter(c => OPEN_STATUSES.includes(c.state))
        : (OPEN_STATUSES.includes(r.state) ? [r] : []);
      const closedList = useChildren
        ? children.filter(c => c.state === 'Done')
        : (r.state === 'Done' || r.completedAt ? [r] : []);
      const total = list.length;
      const open = openList.length;
      const closed = closedList.length;
      const completion = total > 0 ? Math.round((closed / total) * 100) : 0;
      let status = 'blocked';
      if (completion >= 100) status = 'done';
      else if (completion >= 50) status = 'on_track';
      else if (completion >= 25) status = 'at_risk';
      // OKR assignment: parent's project, or first child's project if parent has none
      const projectName = r.project || (r.children && r.children[0] && r.children[0].projectName) || null;
      const okrNum = getOkrNumFromProject(projectName);
      const projectUrl = r.projectUrl || null;
      issuesByOKR[r.id] = list.map(x => ({ id: x.id, title: x.title, team, assignee: x.assignee, priority: x.priority, url: x.url }));
      dkrSummaryByTeam[team] = dkrSummaryByTeam[team] || [];
      dkrSummaryByTeam[team].push({ identifier: r.id, name: r.title, team, total, open, closed, completion, target: 100, status, okrNum });
      dkrRowsByTeam[team].push({
        identifier: r.id, name: r.title, team, total, open, closed, completion, status, okrNum, projectName, projectUrl, list,
        parentState: r.state, parentAssignee: r.assignee, parentUrl: r.url, parentPriority: r.priority, parentDueDate: r.dueDate,
      });
    });
  });

  // OKR 1, 2, 3 CARDS: count only DKR parent issues (not sub-issues). Open/Done = how many DKRs are in that state.
  const okrsDataByTeam = {};
  const issuesByOKRForCards = {};
  const okrCardNames = { 1: 'OKR1', 2: 'OKR2', 3: 'OKR3' };
  MAIN_TEAMS.forEach(team => {
    const teamDkrRows = dkrRowsByTeam[team] || [];
    okrsDataByTeam[team] = [1, 2, 3].map(okrNum => {
      const dkrsForOkr = teamDkrRows.filter(dkr => dkr.okrNum === okrNum);
      const total = dkrsForOkr.length;
      const open = dkrsForOkr.filter(dkr => OPEN_STATUSES.includes(dkr.parentState)).length;
      const closed = dkrsForOkr.filter(dkr => dkr.parentState === 'Done').length;
      const name = dkrsForOkr[0]?.projectName || okrCardNames[okrNum];
      const projectUrl = dkrsForOkr[0]?.projectUrl || null;
      if (dkrsForOkr.length > 0) {
        issuesByOKRForCards[`${team}:${name}`] = dkrsForOkr.map(dkr => ({
          id: dkr.identifier,
          title: dkr.name,
          team,
          assignee: dkr.parentAssignee || 'Unassigned',
          priority: dkr.parentPriority || 'None',
          url: dkr.parentUrl || '',
          state: dkr.parentState || 'Unknown',
        }));
      }
      const completion = total > 0 ? Math.round((closed / total) * 100) : 0;
      const hasOnHold = dkrsForOkr.some(dkr => dkr.parentState === 'On Hold');
      const okrDueDates = dkrsForOkr.map(dkr => dkr.parentDueDate).filter(Boolean);
      const latestDueDate = okrDueDates.length > 0 ? okrDueDates.sort().pop() : null;
      const today = new Date().toISOString().slice(0, 10);
      const isOverdue = latestDueDate != null && today > latestDueDate && completion < 100;
      let status = 'blocked';
      if (hasOnHold) status = 'blocked'; // On Hold prima: si algún DKR está On Hold → Blocked
      else if (completion >= 100) status = 'done';
      else if (isOverdue) status = 'at_risk'; // Se superó la fecha de vencimiento del OKR → At Risk
      else if (completion >= 50) status = 'on_track';
      else if (completion >= 25) status = 'at_risk';
      const burndown = [
        { day: 'Nov 7', remaining: total, ideal: total },
        { day: 'Jan 2', remaining: open + Math.round(closed * 0.3), ideal: Math.round(total * 0.5) },
        { day: new Date().toISOString().slice(0, 10), remaining: open, ideal: 0 },
      ];
      return { name, team, total, open, closed, completion, target: 100, status, url: projectUrl, burndown };
    });
  });
  Object.assign(issuesByOKR, issuesByOKRForCards);

  // Performance: incluir a quien tenga issues cerradas en MAIN_TEAMS (aunque no tenga open), para que aparezca en las cards (ej. Alfonso).
  const assigneesForPerformance = [...new Set([
    ...assignees,
    ...closed.filter(r => MAIN_TEAMS.includes(r.team)).map(r => r.assignee),
  ])].filter(a => a && a !== 'Unassigned');
  const performanceData = [];
  assigneesForPerformance.forEach(a => {
    const personClosed = closed.filter(r => r.assignee === a && MAIN_TEAMS.includes(r.team));
    const closedWithDates = personClosed.filter(r => r.createdAt && r.completedAt);
    
    // Calculate avg_lead_time (days from createdAt to completedAt)
    let avgLeadTime = null;
    if (closedWithDates.length > 0) {
      const totalLeadTime = closedWithDates.reduce((sum, r) => {
        return sum + daysBetween(r.createdAt, r.completedAt);
      }, 0);
      avgLeadTime = Number((totalLeadTime / closedWithDates.length).toFixed(1));
    }
    
    // Calculate breakdown by shirt size for closed issues
    const closedByShirtSize = {};
    ['XS', 'S', 'M', 'L', 'XL', 'Missing'].forEach(size => {
      closedByShirtSize[size] = personClosed.filter(r => (r.shirtSize || 'Missing') === size).length;
    });
    
    // Calculate total points
    const totalPoints = Object.entries(closedByShirtSize).reduce((sum, [size, count]) => {
      return sum + (weightMap[size] || 0) * count;
    }, 0);
    
    // Build by_shirt_size array (only include sizes with count > 0)
    const byShirtSizeArray = Object.entries(closedByShirtSize)
      .filter(([size, count]) => count > 0)
      .map(([size, count]) => ({
        size,
        count,
        points: (weightMap[size] || 0) * count
      }));
    
    // Calculate total_points from by_shirt_size array to ensure consistency
    const calculatedTotalPoints = byShirtSizeArray.reduce((sum, item) => sum + item.points, 0);
    
    performanceData.push({
      assignee: a,
      closed_count: personClosed.length,
      avg_lead_time: avgLeadTime,
      total_points: calculatedTotalPoints,
      by_shirt_size: byShirtSizeArray
    });
  });

  // Calculate Data Quality metrics (only for MAIN_TEAMS, excluding PGA and eliminated issues)
  // Open issues for data quality: only OPEN_STATUSES, only MAIN_TEAMS, exclude Canceled/Duplicate
  const openForDataQuality = open.filter(r => MAIN_TEAMS.includes(r.team));
  
  // Helper functions to detect Company and Group from labels
  const hasCompany = (labels) => {
    // Company labels: specific legal entities (Roxom Ltd, Roxom Markets, Roxom Seychelles, etc.)
    const companyLabels = [
      'Roxom Ltd', 'Roxom Markets', 'Roxom Seychelles', 'Beat the chain', 'Prigui', 'Moxor',
      'Roxom TV Ltd', 'LL21', 'Intergalatic Media', '21 Dragons', 'Orange Pill'
    ];
    return labels.some(l => {
      const labelLower = (l || '').toLowerCase();
      return companyLabels.some(c => labelLower.includes(c.toLowerCase()));
    });
  };
  
  const hasGroup = (labels) => {
    // Group = Roxom | Roxom Global | Roxom TV. En Linear: "Group: Roxom", "Group: Roxom Global", "Group: Roxom TV".
    const arr = Array.isArray(labels) ? labels : [];
    return arr.some(l => {
      const s = (l && (typeof l === 'string' ? l : l.name || l)).toString().toLowerCase().trim();
      if (!s) return false;
      // Exact match (con o sin prefijo "Group: ")
      if (s === 'group: roxom' || s === 'group: roxom global' || s === 'group: roxom tv') return true;
      if (s === 'roxom' || s === 'roxom global' || s === 'roxom tv' || s === 'global') return true;
      // Por si el label tiene variación (ej. "Group: Roxom " o "Group:Roxom")
      if (s.includes('group') && (s.includes('roxom') || s.includes('global'))) return true;
      return false;
    });
  };
  
  const hasWorkType = (labels) => {
    // WorkType: has OKR or BAU labels
    return labels.some(l => {
      const labelLower = (l || '').toLowerCase();
      return labelLower.includes('okr') || labelLower.includes('bau');
    });
  };
  
  // Calculate quality data by team
  const qualityData = [];
  const dataQualityIssues = {};
  
  MAIN_TEAMS.forEach(team => {
    const teamOpen = openForDataQuality.filter(r => r.team === team);
    
    // Find issues missing each field
    const missingShirt = teamOpen.filter(r => (r.shirtSize || 'Missing') === 'Missing');
    const missingCompany = teamOpen.filter(r => !hasCompany(r.labels || []));
    const missingGroup = teamOpen.filter(r => !hasGroup(r.labels || []));
    const missingWorkType = teamOpen.filter(r => !hasWorkType(r.labels || []));
    
    // Calculate completeness: (total fields - missing fields) / total fields * 100
    // 4 fields per issue: Shirt Size, Company, Group, Work Type
    const totalFields = teamOpen.length * 4;
    const missingFields = missingShirt.length + missingCompany.length + missingGroup.length + missingWorkType.length;
    const completeness = totalFields > 0 ? Math.round(((totalFields - missingFields) / totalFields) * 100) : 100;
    
    qualityData.push({
      team,
      open: teamOpen.length,
      missingShirt: missingShirt.length,
      missingCompany: missingCompany.length,
      missingGroup: missingGroup.length,
      missingWorkType: missingWorkType.length,
      completeness
    });
    
    // Build issue lists for each missing field
    dataQualityIssues[team] = {
      missingShirt: missingShirt.map(r => ({
        id: r.id,
        title: r.title,
        assignee: r.assignee,
        status: r.state,
        url: r.url
      })),
      missingCompany: missingCompany.map(r => ({
        id: r.id,
        title: r.title,
        assignee: r.assignee,
        status: r.state,
        url: r.url
      })),
      missingGroup: missingGroup.map(r => ({
        id: r.id,
        title: r.title,
        assignee: r.assignee,
        status: r.state,
        url: r.url
      })),
      missingWorkType: missingWorkType.map(r => ({
        id: r.id,
        title: r.title,
        assignee: r.assignee,
        status: r.state,
        url: r.url
      }))
    };
  });

  // weeklyData: last 11 weeks, created/closed/openEnd from MAIN_TEAMS issues
  const weekKeys = getLast11WeekKeys();
  const weeklyData = weekKeys.map((w, idx) => {
    const weekStart = w.weekStart;
    const nextMonday = new Date(weekStart);
    nextMonday.setDate(nextMonday.getDate() + 7);
    const weekEnd = nextMonday.toISOString().slice(0, 10);
    const created = rowsActive.filter(r => MAIN_TEAMS.includes(r.team) && r.createdAt && r.createdAt.slice(0, 10) >= weekStart && r.createdAt.slice(0, 10) < weekEnd).length;
    const closed = closedForSla.filter(r => r.completedAt && r.completedAt.slice(0, 10) >= weekStart && r.completedAt.slice(0, 10) < weekEnd).length;
    let openEnd = totalOpen;
    for (let j = idx + 1; j < weekKeys.length; j++) {
      const ws = weekKeys[j].weekStart;
      const we = new Date(ws);
      we.setDate(we.getDate() + 7);
      const weStr = we.toISOString().slice(0, 10);
      const c = rowsActive.filter(r => MAIN_TEAMS.includes(r.team) && r.createdAt && r.createdAt.slice(0, 10) >= ws && r.createdAt.slice(0, 10) < weStr).length;
      const cl = closedForSla.filter(r => r.completedAt && r.completedAt.slice(0, 10) >= ws && r.completedAt.slice(0, 10) < weStr).length;
      openEnd += c - cl;
    }
    const displayWeek = w.key.length >= 6 ? w.key.slice(2) : w.key;
    return { week: displayWeek, weekStart, created, closed, openEnd };
  });

  // cycleTimeData: bucket closed issues by days (createdAt -> completedAt)
  const buckets = { '0-3d': 0, '4-7d': 0, '8-14d': 0, '15-30d': 0, '30+d': 0 };
  closedWithDatesOnly.forEach(r => {
    const days = daysBetween(r.createdAt, r.completedAt);
    if (days <= 3) buckets['0-3d']++;
    else if (days <= 7) buckets['4-7d']++;
    else if (days <= 14) buckets['8-14d']++;
    else if (days <= 30) buckets['15-30d']++;
    else buckets['30+d']++;
  });
  const totalCycle = Object.values(buckets).reduce((s, n) => s + n, 0);
  const cycleTimeData = Object.entries(buckets).map(([range, count]) => ({
    range,
    count,
    pct: totalCycle > 0 ? Math.round((count / totalCycle) * 100) : 0
  }));

  return {
    summaryStats,
    teamDetailedData,
    assigneeDetailedData,
    performanceData,
    qualityData,
    dataQualityIssues,
    weeklyData,
    cycleTimeData,
    deletedIssueIds,
    issuesByStatus: byStatus,
    issuesByPriority: byPriority,
    issuesByShirtSize,
    okrsDataByTeam,
    dkrSummaryByTeam,
    issuesByOKR,
    canceledIssues: canceledForAll.map(r => ({ id: r.id, title: r.title, team: r.team, assignee: r.assignee, priority: r.priority, url: r.url })),
    duplicatedIssues: duplicatedForAll.map(r => ({ id: r.id, title: r.title, team: r.team, assignee: r.assignee, priority: r.priority, url: r.url })),
  };
}

function jsString(obj) {
  return JSON.stringify(obj, null, 4)
    .replace(/"([^"]+)":/g, '$1:')
    .replace(/"/g, "'")
    .replace(/'(\d+)'/g, '$1')
    .replace(/'(true|false)'/g, '$1')
    .replace(/'(null)'/g, '$1');
}

function formatSummaryStatsBlock(data) {
  const s = data.summaryStats;
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '-');
  const isoNow = new Date().toISOString();
  let out = `        // Summary stats (UPDATED FROM LINEAR - ${dateStr})\n`;
  out += `        const lastLinearSyncAt = '${isoNow}'; // Updated by sync-linear-to-dashboard.js\n`;
  out += `        const summaryStats = {\n`;
  out += `            total: ${s.total},\n`;
  out += `            totalOpen: ${s.totalOpen},\n`;
  out += `            totalClosed: ${s.totalClosed},\n`;
  out += `            overdue: ${s.overdue},\n`;
  out += `            dueSoon: ${s.dueSoon},\n`;
  out += `            noDueDate: ${s.noDueDate},\n`;
  out += `            unassigned: ${s.unassigned},\n`;
  out += `            avgCycleTime: ${s.avgCycleTime},\n`;
  out += `            avgCycleTimePrev: ${s.avgCycleTimePrev},\n`;
  out += `            velocity: ${s.velocity},\n`;
  out += `            velocityPrev: ${s.velocityPrev},\n`;
  out += `            slaCompliance: ${s.slaCompliance},\n`;
  out += `            slaCompliancePrev: ${s.slaCompliancePrev},\n`;
  out += `            byStatus: ${JSON.stringify(s.byStatus)},\n`;
  out += `            byPriority: ${JSON.stringify(s.byPriority)},\n`;
  out += `            byShirtSize: ${JSON.stringify(s.byShirtSize)},\n`;
  out += `            byWorkType: ${JSON.stringify(s.byWorkType)},\n`;
  out += `            byTeam: ${JSON.stringify(s.byTeam)},\n`;
  out += `            byAssignee: ${JSON.stringify(s.byAssignee)},\n`;
  out += `            overdueIssues: [\n`;
  s.overdueIssues.forEach(i => {
    const title = (i.title || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const assignee = (i.assignee || '').replace(/'/g, "\\'");
    out += `                { id: '${i.id}', title: '${title}', team: '${i.team}', due_date: '${i.due_date}', days_overdue: ${i.days_overdue}, assignee: '${assignee}', priority: '${i.priority}', url: '${i.url}' },\n`;
  });
  out += `            ],\n`;
  out += `            dueSoonIssues: ${JSON.stringify(s.dueSoonIssues)},\n`;
  out += `            closedIssues: [\n`;
  s.closedIssues.forEach(i => {
    const title = (i.title || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const assignee = (i.assignee || '').replace(/'/g, "\\'");
    out += `                { id: '${i.id}', title: '${title}', team: '${i.team}', assignee: '${assignee}', priority: '${i.priority}', url: '${i.url}', completedAt: '${i.completedAt || ''}', createdAt: '${i.createdAt || ''}' },\n`;
  });
  out += `            ],\n`;
  out += `            canceledCount: ${s.canceledCount},\n`;
  out += `            duplicatedCount: ${s.duplicatedCount},\n`;
  out += `            canceledByTeam: ${JSON.stringify(s.canceledByTeam)},\n`;
  out += `            duplicatedByTeam: ${JSON.stringify(s.duplicatedByTeam)},\n`;
  out += `            canceledByAssignee: ${JSON.stringify(s.canceledByAssignee)},\n`;
  out += `            duplicatedByAssignee: ${JSON.stringify(s.duplicatedByAssignee)}\n`;
  out += `        };\n\n`;
  return out;
}

function formatTeamDetailedBlock(data) {
  const t = data.teamDetailedData;
  let out = `        // Team detailed data (UPDATED FROM LINEAR API ${new Date().toISOString().slice(0, 10)})\n`;
  out += `        const teamDetailedData = {\n`;
  Object.entries(t).forEach(([key, v]) => {
    out += `            '${key}': {\n`;
    out += `                total: ${v.total}, open: ${v.open}, closed: ${v.closed}, overdue: ${v.overdue},\n`;
    out += `                byStatus: ${JSON.stringify(v.byStatus)},\n`;
    out += `                byPriority: ${JSON.stringify(v.byPriority)},\n`;
    out += `                byShirtSize: ${JSON.stringify(v.byShirtSize)},\n`;
    out += `                overdueIssues: summaryStats.overdueIssues.filter(i => i.team === '${key}'),\n`;
    out += `                issuesByShirtSize: ${JSON.stringify(v.issuesByShirtSize || {})}\n`;
    out += `            },\n`;
  });
  out += `        };\n\n`;
  return out;
}

function formatAssigneeDetailedBlock(data) {
  const a = data.assigneeDetailedData;
  let out = `        // Assignee detailed data (UPDATED FROM LINEAR API)\n`;
  out += `        const assigneeDetailedData = {\n`;
  Object.entries(a).forEach(([key, v]) => {
    const safeKey = key.replace(/'/g, "\\'");
    out += `            '${safeKey}': {\n`;
    out += `                open: ${v.open}, closed: ${v.closed}, overdue: ${v.overdue}, weighted: ${v.weighted},\n`;
    out += `                byStatus: ${JSON.stringify(v.byStatus)},\n`;
    out += `                byPriority: ${JSON.stringify(v.byPriority)},\n`;
    out += `                byShirtSize: ${JSON.stringify(v.byShirtSize)},\n`;
    out += `                overdueIssues: summaryStats.overdueIssues.filter(i => i.assignee === '${safeKey}'),\n`;
    out += `                issuesByShirtSize: ${JSON.stringify(v.issuesByShirtSize || {})}\n`;
    out += `            },\n`;
  });
  out += `        };\n\n`;
  return out;
}

function formatDeletedIssueIds(data) {
  const ids = data.deletedIssueIds || [];
  return `        const deletedIssueIds = new Set(${JSON.stringify(ids)});\n`;
}

function formatIssuesByStatus(data) {
  return `        const issuesByStatus = ${JSON.stringify(data.issuesByStatus)};\n`;
}

function formatIssuesByPriority(data) {
  return `        const issuesByPriority = ${JSON.stringify(data.issuesByPriority)};\n`;
}

function formatIssuesByShirtSize(data) {
  return `        const issuesByShirtSize = ${JSON.stringify(data.issuesByShirtSize)};\n`;
}

function formatPerformanceDataBlock(data) {
  const p = data.performanceData;
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '-');
  let out = `        // Performance data (UPDATED FROM LINEAR - ${dateStr})\n`;
  out += `        // avg_lead_time: days from createdAt to completedAt for closed issues\n`;
  out += `        // by_shirt_size: breakdown of closed issues by shirt size label\n`;
  out += `        // total_points: sum of (count * weight) for each shirt size\n`;
  out += `        const performanceData = [\n`;
  p.forEach(perf => {
    const safeAssignee = perf.assignee.replace(/'/g, "\\'");
    out += `            {\n`;
    out += `                assignee: '${safeAssignee}',\n`;
    out += `                closed_count: ${perf.closed_count},\n`;
    out += `                avg_lead_time: ${perf.avg_lead_time !== null ? perf.avg_lead_time : 0},\n`;
    out += `                total_points: ${perf.total_points},\n`;
    out += `                by_shirt_size: ${JSON.stringify(perf.by_shirt_size)}\n`;
    out += `            },\n`;
  });
  out += `        ];\n\n`;
  return out;
}

function formatWeeklyDataBlock(data) {
  const w = data.weeklyData || [];
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '-');
  let out = `        // Weekly velocity data (UPDATED FROM LINEAR - ${dateStr})\n`;
  out += `        const weeklyData = [\n`;
  w.forEach(row => {
    out += `            { week: '${row.week}', weekStart: '${row.weekStart}', created: ${row.created}, closed: ${row.closed}, openEnd: ${row.openEnd} },\n`;
  });
  out += `        ];\n\n`;
  return out;
}

function formatCycleTimeDataBlock(data) {
  const c = data.cycleTimeData || [];
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '-');
  let out = `        // Cycle time data (UPDATED FROM LINEAR - ${dateStr})\n`;
  out += `        const cycleTimeData = [\n`;
  c.forEach(row => {
    out += `            { range: '${row.range}', count: ${row.count}, pct: ${row.pct} },\n`;
  });
  out += `        ];\n\n`;
  return out;
}

function formatDataQualityBlock(data) {
  const q = data.qualityData;
  const dqi = data.dataQualityIssues;
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '-');
  let out = `        // Data Quality (from v3)\n`;
  out += `        // qualityData synced with teamDetailedData open counts\n`;
  out += `        // v33: qualityData updated dynamically from Linear API (${dateStr})\n`;
  out += `        // Excludes eliminated issues (Canceled, Duplicate)\n`;
  out += `        // WorkType = issues without BAU, BAU - Recurring, or OKRs labels\n`;
  out += `        const qualityData = [\n`;
  q.forEach(team => {
    out += `            { team: '${team.team}', open: ${team.open}, missingShirt: ${team.missingShirt}, missingCompany: ${team.missingCompany}, missingGroup: ${team.missingGroup}, missingWorkType: ${team.missingWorkType}, completeness: ${team.completeness} },\n`;
  });
  out += `        ];\n\n`;
  
  out += `        // Data Quality Issues by Team and Field (for sidebar)\n`;
  out += `        // v33: Real data from Linear query (${dateStr})\n`;
  out += `        // Source: list_issues for each team using FULL team names\n`;
  out += `        // Excludes eliminated issues (Canceled, Duplicate)\n`;
  out += `        const dataQualityIssues = {\n`;
  Object.entries(dqi).forEach(([team, fields]) => {
    out += `            '${team}': {\n`;
    ['missingShirt', 'missingCompany', 'missingGroup', 'missingWorkType'].forEach(field => {
      out += `                ${field}: [\n`;
      (fields[field] || []).forEach(issue => {
        const safeTitle = (issue.title || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const safeAssignee = (issue.assignee || '').replace(/'/g, "\\'");
        out += `                    { id: '${issue.id}', title: '${safeTitle}', assignee: '${safeAssignee}', status: '${issue.status}', url: '${issue.url}' },\n`;
      });
      out += `                ],\n`;
    });
    out += `            },\n`;
  });
  out += `        };\n\n`;
  return out;
}

function formatOkrDataByTeamBlock(data) {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '-');
  const okrsByTeam = data.okrsDataByTeam || {};
  let out = `        // OKR Data by Team (CARDS: only OKR 1, 2, 3 from Linear project)\n`;
  out += `        // UPDATED FROM LINEAR - ${dateStr}\n`;
  out += `        const okrsDataByTeam = {\n`;
  ['Comp-leg', 'FCP', 'LTO', 'RPA'].forEach(team => {
    const arr = okrsByTeam[team] || [];
    out += `            '${team}': [\n`;
    arr.forEach(okr => {
      const safeName = (okr.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      out += `                {\n`;
      out += `                    name: '${safeName}',\n`;
      out += `                    team: '${okr.team}',\n`;
      out += `                    total: ${okr.total}, open: ${okr.open}, closed: ${okr.closed},\n`;
      out += `                    completion: ${okr.completion}, target: ${okr.target || 100},\n`;
      out += `                    status: '${okr.status}',\n`;
      out += `                    url: ${okr.url ? `'${String(okr.url).replace(/'/g, "\\'")}'` : 'null'},\n`;
      out += `                    burndown: ${JSON.stringify(okr.burndown || [])}\n`;
      out += `                },\n`;
    });
    out += `            ],\n`;
  });
  out += `        };\n\n`;
  return out;
}

function formatDkrSummaryBlock(data) {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '-');
  const dkrByTeam = data.dkrSummaryByTeam || {};
  let out = `        // DKR Summary by Team (TABLE only - OKR Summary table rows)\n`;
  out += `        // UPDATED FROM LINEAR - ${dateStr} (issues with DKR in title)\n`;
  out += `        const dkrSummaryByTeam = {\n`;
  ['Comp-leg', 'FCP', 'LTO', 'RPA'].forEach(team => {
    const arr = dkrByTeam[team] || [];
    out += `            '${team}': [\n`;
    arr.forEach(row => {
      const safeName = (row.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const okrNum = row.okrNum != null ? row.okrNum : 'null';
      out += `                { identifier: '${row.identifier || ''}', name: '${safeName}', team: '${row.team}', total: ${row.total}, open: ${row.open}, closed: ${row.closed}, completion: ${row.completion}, target: ${row.target || 100}, status: '${row.status}', okrNum: ${okrNum} },\n`;
    });
    out += `            ],\n`;
  });
  out += `        };\n\n`;
  return out;
}

function formatIssuesByOKRBlock(data) {
  const issuesByOKR = data.issuesByOKR || {};
  let out = `        // Issues by OKR - from Linear (issues with "okr" label, grouped by OKR)\n`;
  out += `        const issuesByOKR = {\n`;
  Object.entries(issuesByOKR).forEach(([okrName, list]) => {
    const safeName = okrName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    out += `            '${safeName}': [\n`;
    (list || []).forEach(issue => {
      const title = (issue.title || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const assignee = (issue.assignee || '').replace(/'/g, "\\'");
      const state = (issue.state || '').replace(/'/g, "\\'");
      out += `                { id: '${issue.id}', title: '${title}', team: '${issue.team}', assignee: '${assignee}', priority: '${issue.priority}', url: '${String(issue.url || '').replace(/'/g, "\\'")}', state: '${state}' },\n`;
    });
    out += `            ],\n`;
  });
  out += `        };\n\n`;
  return out;
}

function transformMCPToSyncFormat(mcpIssues) {
  return mcpIssues.map(issue => {
    const stateName = issue.status || issue.state?.name || '';
    const isDeletedState = /canceled|duplicate|deleted|archived|trashed|restore/i.test(stateName);
    const trashed = !!(issue.trashed ?? issue.trashedAt ?? isDeletedState);
    return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    dueDate: issue.dueDate,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    completedAt: issue.completedAt,
    trashed,
    priority: issue.priority?.value ?? issue.priority ?? 4,
    state: {
      name: issue.status || issue.state?.name || 'Unknown',
      type: issue.state?.type || 'started'
    },
    team: {
      key: issue.team === 'Comp-leg' ? 'Comp-leg' : 
           issue.team === 'Financial Crime Prevention' ? 'FCP' :
           issue.team === 'Legal Tech Operations' ? 'LTO' :
           issue.team === 'Regulatory and Public Affairs' ? 'RPA' :
           issue.team === 'PGA' ? 'PGA' : issue.team,
      name: issue.team,
      id: issue.teamId
    },
    assignee: {
      name: issue.assignee || 'Unassigned'
    },
    labels: {
      nodes: (issue.labels || []).map(l => ({ name: typeof l === 'string' ? l : l.name || l }))
    }
  };
  });
}

async function main() {
  let issues;
  
  // Check if issues file is provided as argument (for MCP usage)
  if (process.argv[2] && fs.existsSync(process.argv[2])) {
    console.log(`Reading issues from ${process.argv[2]}...`);
    const mcpIssues = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    console.log(`Found ${mcpIssues.length} issues from MCP.`);
    issues = transformMCPToSyncFormat(mcpIssues);
  } else if (!API_KEY) {
    console.error('Set LINEAR_API_KEY in the environment, or provide issues JSON file as argument.');
    console.error('Usage: node sync-linear-to-dashboard.js [issues.json]');
    process.exit(1);
  } else {
    console.log('Fetching issues from Linear...');
    issues = await fetchAllIssues();
    console.log(`Fetched ${issues.length} issues.`);
  }
  
  const data = buildDashboardData(issues);

  const htmlPath = HTML_FILE;
  let html = fs.readFileSync(htmlPath, 'utf8');

  const summaryBlock = formatSummaryStatsBlock(data);
  const teamBlock = formatTeamDetailedBlock(data);
  const assigneeBlock = formatAssigneeDetailedBlock(data);
  const performanceBlock = formatPerformanceDataBlock(data);
  const dataQualityBlock = formatDataQualityBlock(data);
  const weeklyBlock = formatWeeklyDataBlock(data);
  const cycleTimeBlock = formatCycleTimeDataBlock(data);

  const weeklyStart = html.indexOf('        // Weekly velocity data');
  const weeklyEnd = html.indexOf('        ];\n\n        // Cycle time data', weeklyStart);
  if (weeklyStart !== -1 && weeklyEnd !== -1) {
    html = html.slice(0, weeklyStart) + weeklyBlock + html.slice(weeklyEnd + '        ];\n\n'.length);
  }

  const cycleTimeStart = html.indexOf('        // Cycle time data');
  const cycleTimeEnd = html.indexOf('        ];\n\n        // Summary stats', cycleTimeStart);
  if (cycleTimeStart !== -1 && cycleTimeEnd !== -1) {
    html = html.slice(0, cycleTimeStart) + cycleTimeBlock + html.slice(cycleTimeEnd + '        ];\n\n'.length);
  }

  const summaryEnd = html.indexOf('        // Team detailed data');
  // Start from the first "Summary stats" comment so we replace the full block (including lastLinearSyncAt and any duplicate lines)
  let summaryStart = html.indexOf('        // Summary stats (UPDATED FROM LINEAR');
  if (summaryStart === -1) summaryStart = html.indexOf('        const lastLinearSyncAt = ');
  if (summaryStart === -1) summaryStart = html.indexOf('        const summaryStats = {');
  if (summaryStart === -1 || summaryEnd === -1) {
    console.error('Could not find summaryStats block in HTML.');
    process.exit(1);
  }
  html = html.slice(0, summaryStart) + summaryBlock + html.slice(summaryEnd);

  const teamStart = html.indexOf('        // Team detailed data');
  const pgaCommentStart = html.indexOf('            // PGA: Team satélite', teamStart);
  const teamBlockEnd = html.indexOf('        };\n\n        // PGA data filtered', teamStart);
  const pgaBlock = html.slice(pgaCommentStart, teamBlockEnd + '        };'.length);
  const mainTeamsBlock = formatTeamDetailedBlock(data).replace(/\n\s*\};\s*\n\s*$/, '');
  const newTeamBlockFull = mainTeamsBlock + '\n            ' + pgaBlock.slice(pgaBlock.indexOf('// PGA:'));
  html = html.slice(0, teamStart) + newTeamBlockFull + '\n\n        // PGA data filtered' + html.slice(teamBlockEnd + '        };'.length + '\n\n        // PGA data filtered'.length);

  const assigneeStart = html.indexOf('        // Assignee detailed data');
  const assigneeEnd = html.indexOf('        };\n\n        // Performance data', assigneeStart);
  if (assigneeStart !== -1 && assigneeEnd !== -1) {
    html = html.slice(0, assigneeStart) + assigneeBlock + html.slice(assigneeEnd + '        };\n\n'.length);
  }

  const performanceStart = html.indexOf('        // Performance data (refreshed from Linear API');
  const performanceEnd = html.indexOf('        ];\n\n        // OKR Data by Team', performanceStart);
  if (performanceStart !== -1 && performanceEnd !== -1) {
    html = html.slice(0, performanceStart) + performanceBlock + html.slice(performanceEnd + '        ];\n\n'.length);
  }

  // Deleted/trashed issue IDs (excluded from sidebar when clicking bars)
  const deletedIdsStart = html.indexOf('        const deletedIssueIds = new Set(');
  const deletedIdsEnd = html.indexOf(');\n', deletedIdsStart);
  if (deletedIdsStart !== -1 && deletedIdsEnd !== -1) {
    html = html.slice(0, deletedIdsStart) + formatDeletedIssueIds(data) + html.slice(deletedIdsEnd + 2);
  }

  const isbStart = html.indexOf('        const issuesByStatus = ');
  const isbEnd = html.indexOf(';\n        const issuesByPriority = ', isbStart);
  if (isbStart !== -1 && isbEnd !== -1) {
    html = html.slice(0, isbStart) + formatIssuesByStatus(data) + html.slice(isbEnd + 2);
  }

  const ibpStart = html.indexOf('        const issuesByPriority = ');
  const ibpEnd = html.indexOf(';\n        // Issues by Shirt Size', ibpStart);
  if (ibpStart !== -1 && ibpEnd !== -1) {
    html = html.slice(0, ibpStart) + formatIssuesByPriority(data) + html.slice(ibpEnd + 2);
  }

  const ibsStart = html.indexOf('        const issuesByShirtSize = {');
  const ibsEnd = html.indexOf('        };\n\n        // Issues by OKR', ibsStart);
  if (ibsStart !== -1 && ibsEnd !== -1) {
    html = html.slice(0, ibsStart) + formatIssuesByShirtSize(data) + html.slice(ibsEnd + '        };'.length);
  }

  // Update Data Quality blocks (block ends with }; then "// Issues by Status")
  const qualityDataStart = html.indexOf('        // Data Quality (from v3)');
  const qualityDataEnd = html.indexOf('        };\n\n        // Issues by Status', qualityDataStart);
  if (qualityDataStart !== -1 && qualityDataEnd !== -1) {
    html = html.slice(0, qualityDataStart) + dataQualityBlock + html.slice(qualityDataEnd + '        };\n\n'.length);
  }

  // OKR Data by Team (cards: OKR 1,2,3) + DKR Summary (table rows)
  const okrDataByTeamStart = html.indexOf('        // OKR Data by Team');
  const okrLegacyStart = html.indexOf('        // Legacy okrsData', okrDataByTeamStart);
  if (okrDataByTeamStart !== -1 && okrLegacyStart !== -1) {
    html = html.slice(0, okrDataByTeamStart) + formatOkrDataByTeamBlock(data) + formatDkrSummaryBlock(data) + html.slice(okrLegacyStart);
  }

  // Issues by OKR (for sidebar)
  const issuesByOKRStart = html.indexOf('        // Issues by OKR');
  const issuesByOKREnd = html.indexOf('        // Extended overdue issues by team', issuesByOKRStart);
  if (issuesByOKRStart !== -1 && issuesByOKREnd !== -1) {
    html = html.slice(0, issuesByOKRStart) + formatIssuesByOKRBlock(data) + html.slice(issuesByOKREnd);
  }

  fs.writeFileSync(htmlPath, html);
  console.log('Dashboard HTML updated successfully.');
  console.log(`Summary: ${data.summaryStats.totalOpen} open, ${data.summaryStats.overdue} overdue, ${data.summaryStats.totalClosed} closed.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
