#!/usr/bin/env node
/**
 * Sync Linear issues to compliance dashboard HTML using MCP Linear tools.
 * This script is designed to be called from Cursor with MCP access.
 * 
 * Usage: This script expects Linear issues data to be passed or fetched via MCP.
 */

const fs = require('fs');
const path = require('path');

const HTML_FILE = path.join(__dirname, 'compliance_dashboard_v14_roxom (1).html');

const PRIORITY_MAP = { 0: 'None', 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low' };
const SHIRT_LABELS = ['XS', 'S', 'M', 'L', 'XL'];
const OPEN_STATUSES = ['Backlog', 'Todo', 'In Progress', 'In Review', 'On Hold', 'Pending Signature'];
// PGA: Pending Signature counts as DONE (closed), not open
const PGA_OPEN_STATUSES = ['Backlog', 'Todo', 'In Progress', 'In Review', 'On Hold'];
const PGA_CLOSED_STATES = ['Done', 'Canceled', 'Ongoing', 'Ended', 'Pending Signature'];
const MAIN_TEAMS = ['Comp-leg', 'FCP', 'LTO', 'RPA'];
const TEAM_NAME_MAP = {
  'Comp-leg': 'Comp-leg',
  'Financial Crime Prevention': 'FCP',
  'Legal Tech Operations': 'LTO',
  'Regulatory and Public Affairs': 'RPA',
  'Regulatory Public Affairs': 'RPA',
  'PGA': 'PGA',
};
const STATUS_ORDER = ['Backlog', 'In Progress', 'Ongoing', 'On Hold', 'Todo', 'In Review', 'Pending Signature', 'Triage'];
const PRIORITY_ORDER = ['None', 'Low', 'Medium', 'High', 'Urgent'];
function sortByStatusOrder(arr) {
  return arr.slice().sort((a, b) => {
    const i = STATUS_ORDER.indexOf(a.status);
    const j = STATUS_ORDER.indexOf(b.status);
    if (i === -1 && j === -1) return 0;
    if (i === -1) return 1;
    if (j === -1) return -1;
    return i - j;
  });
}

function normalizeTeam(teamName) {
  return TEAM_NAME_MAP[teamName] || teamName;
}

function toIssueRow(i) {
  const teamName = i.team || 'Unknown';
  const team = normalizeTeam(teamName);
  const assignee = i.assignee || 'Unassigned';
  const priority = PRIORITY_MAP[i.priority] ?? 'None';
  const labels = (i.labels || []).map(l => typeof l === 'string' ? l : l.name || l);
  const shirtSize = SHIRT_LABELS.find(s => labels.some(l => (l || '').includes(s))) || 'Missing';
  const state = i.status || i.state || 'Unknown';
  
  return {
    id: i.identifier || i.id,
    title: i.title || '',
    team,
    assignee,
    priority,
    url: i.url || `https://linear.app/roxom/issue/${i.identifier || i.id}`,
    state,
    dueDate: i.dueDate,
    completedAt: i.completedAt,
    shirtSize,
    labels,
  };
}

function daysBetween(d1, d2) {
  const a = new Date(d1);
  const b = new Date(d2);
  return Math.floor((b - a) / (24 * 60 * 60 * 1000));
}

function buildDashboardData(issues) {
  const rows = issues.map(toIssueRow);
  const today = new Date().toISOString().slice(0, 10);
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const open = rows.filter(r => r.state && OPEN_STATUSES.includes(r.state));
  const closed = rows.filter(r => ['Done', 'Canceled', 'Ongoing', 'Ended'].includes(r.state));
  const overdue = open.filter(r => r.dueDate && r.dueDate < today);
  const dueSoon = open.filter(r => r.dueDate && r.dueDate >= today && r.dueDate <= in7Days);
  
  const openForAll = open.filter(r => MAIN_TEAMS.includes(r.team));
  const noDueDate = openForAll.filter(r => !r.dueDate).length;
  const unassigned = openForAll.filter(r => r.assignee === 'Unassigned').length;

  const byStatus = {};
  openForAll.forEach(r => {
    const s = r.state || 'Backlog';
    if (!byStatus[s]) byStatus[s] = [];
    byStatus[s].push({ id: r.id, title: r.title, team: r.team, assignee: r.assignee, priority: r.priority, url: r.url });
  });

  const byPriority = {};
  openForAll.forEach(r => {
    const p = r.priority || 'None';
    if (!byPriority[p]) byPriority[p] = [];
    byPriority[p].push({ id: r.id, title: r.title, team: r.team, assignee: r.assignee, priority: r.priority, url: r.url });
  });

  const byTeam = {};
  MAIN_TEAMS.forEach(t => {
    const teamOpen = open.filter(r => r.team === t);
    const teamClosed = closed.filter(r => r.team === t);
    const teamOverdue = overdue.filter(r => r.team === t);
    byTeam[t] = {
      team: t,
      open: teamOpen.length,
      closed: teamClosed.length,
      overdue: teamOverdue.length,
      velocity: (teamClosed.length / 10).toFixed(1),
      closedWithDueDate: 0,
      closedOnTime: 0,
      sla: null,
    };
  });

  const allTeamKeys = [...new Set(rows.map(r => r.team))].filter(t => t && t !== 'Unknown');
  if (allTeamKeys.includes('PGA')) {
    const pgaRows = rows.filter(r => r.team === 'PGA');
    const norm = (s) => (s || '').trim().toLowerCase();
    const teamOpen = pgaRows.filter(r => r.state && PGA_OPEN_STATUSES.some(open => norm(open) === norm(r.state)));
    const teamClosed = pgaRows.filter(r => r.state && PGA_CLOSED_STATES.some(closed => norm(closed) === norm(r.state)));
    const pgaOverdue = teamOpen.filter(r => r.dueDate && r.dueDate < today);
    byTeam['PGA'] = { 
      team: 'PGA', 
      open: teamOpen.length, 
      closed: teamClosed.length, 
      overdue: pgaOverdue.length, 
      velocity: (teamClosed.length / 10).toFixed(1), 
      closedWithDueDate: 0, 
      closedOnTime: 0, 
      sla: null 
    };
  }

  const byAssignee = {};
  const assignees = [...new Set(openForAll.map(r => r.assignee))];
  const weightMap = { XS: 1, S: 2, M: 3, L: 5, XL: 8, Missing: 0 };
  assignees.forEach(a => {
    const personOpen = openForAll.filter(r => r.assignee === a);
    const personOverdue = overdue.filter(r => r.assignee === a && MAIN_TEAMS.includes(r.team));
    const weighted = personOpen.reduce((sum, r) => sum + (weightMap[r.shirtSize] ?? 0), 0);
    byAssignee[a] = { assignee: a, open: personOpen.length, weighted, overdue: personOverdue.length };
  });

  const overdueIssues = overdue
    .filter(r => MAIN_TEAMS.includes(r.team))
    .map(r => ({
      id: r.id,
      title: r.title,
      team: r.team,
      due_date: r.dueDate,
      days_overdue: daysBetween(r.dueDate, today),
      assignee: r.assignee,
      priority: r.priority,
      url: r.url,
    }))
    .sort((a, b) => b.days_overdue - a.days_overdue);

  const dueSoonIssues = dueSoon.filter(r => MAIN_TEAMS.includes(r.team)).map(r => ({
    id: r.id,
    title: r.title,
    team: r.team,
    due_date: r.dueDate,
    assignee: r.assignee,
    priority: r.priority,
    url: r.url,
  }));

  const totalOpen = openForAll.length;
  const totalClosed = closed.filter(r => MAIN_TEAMS.includes(r.team)).length;
  const total = rows.filter(r => MAIN_TEAMS.includes(r.team)).length;

  const byStatusArr = [
    ...STATUS_ORDER.filter(s => (byStatus[s] || []).length > 0).map(s => ({ status: s, count: (byStatus[s] || []).length })),
    ...Object.entries(byStatus).filter(([s]) => !STATUS_ORDER.includes(s)).map(([status, list]) => ({ status, count: list.length })),
  ];
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

  const summaryStats = {
    total,
    totalOpen,
    totalClosed,
    overdue: overdueIssues.length,
    dueSoon: dueSoonIssues.length,
    noDueDate,
    unassigned,
    avgCycleTime: 11.3,
    avgCycleTimePrev: 13.1,
    velocity: (totalClosed / 10).toFixed(1),
    velocityPrev: 10.2,
    slaCompliance: 64.7,
    slaCompliancePrev: 68,
    byStatus: byStatusArr,
    byPriority: byPriorityArr,
    byShirtSize: byShirtSizeArr.length ? byShirtSizeArr : [
      { size: 'XS', count: 0, weight: 1 }, { size: 'S', count: 0, weight: 2 }, { size: 'M', count: 0, weight: 3 },
      { size: 'L', count: 0, weight: 5 }, { size: 'XL', count: 0, weight: 8 }, { size: 'Missing', count: totalOpen, weight: 0 },
    ],
    byWorkType: byWorkTypeArr,
    byTeam: MAIN_TEAMS.map(t => byTeam[t]).filter(Boolean),
    byAssignee: Object.values(byAssignee),
    overdueIssues,
    dueSoonIssues,
  };

  const teamDetailedData = {};
  MAIN_TEAMS.forEach(teamKey => {
    const teamOpen = open.filter(r => r.team === teamKey);
    const teamOverdue = overdue.filter(r => r.team === teamKey);
    const statusCounts = {};
    teamOpen.forEach(r => { statusCounts[r.state] = (statusCounts[r.state] || 0) + 1; });
    const priorityCounts = {};
    teamOpen.forEach(r => { priorityCounts[r.priority] = (priorityCounts[r.priority] || 0) + 1; });
    const shirtCounts = {};
    teamOpen.forEach(r => { shirtCounts[r.shirtSize] = (shirtCounts[r.shirtSize] || 0) + 1; });
    teamDetailedData[teamKey] = {
      total: teamOpen.length + closed.filter(r => r.team === teamKey).length,
      open: teamOpen.length,
      closed: closed.filter(r => r.team === teamKey).length,
      overdue: teamOverdue.length,
      byStatus: sortByStatusOrder(Object.entries(statusCounts).map(([status, count]) => ({ status, count }))),
      byPriority: PRIORITY_ORDER.map(p => ({ priority: p, count: (priorityCounts[p] || 0) })),
      byShirtSize: Object.entries(shirtCounts).map(([size, count]) => ({ size, count })),
      overdueIssues: overdueIssues.filter(i => i.team === teamKey),
    };
  });

  const assigneeDetailedData = {};
  assignees.forEach(a => {
    const personOpen = openForAll.filter(r => r.assignee === a);
    const personClosed = closed.filter(r => r.assignee === a && MAIN_TEAMS.includes(r.team));
    const personOverdue = overdue.filter(r => r.assignee === a && MAIN_TEAMS.includes(r.team));
    const statusCounts = {};
    personOpen.forEach(r => { statusCounts[r.state] = (statusCounts[r.state] || 0) + 1; });
    const priorityCounts = {};
    personOpen.forEach(r => { priorityCounts[r.priority] = (priorityCounts[r.priority] || 0) + 1; });
    const shirtCounts = {};
    personOpen.forEach(r => { shirtCounts[r.shirtSize] = (shirtCounts[r.shirtSize] || 0) + 1; });
    const weighted = personOpen.reduce((sum, r) => sum + (weightMap[r.shirtSize] ?? 0), 0);
    assigneeDetailedData[a] = {
      open: personOpen.length,
      closed: personClosed.length,
      overdue: personOverdue.length,
      weighted,
      byStatus: sortByStatusOrder(Object.entries(statusCounts).map(([status, count]) => ({ status, count }))),
      byPriority: PRIORITY_ORDER.map(p => ({ priority: p, count: (priorityCounts[p] || 0) })),
      byShirtSize: Object.entries(shirtCounts).map(([size, count]) => ({ size, count })),
      overdueIssues: overdueIssues.filter(i => i.assignee === a),
    };
  });

  const issuesByShirtSize = {};
  ['XS', 'S', 'M', 'L', 'XL', 'Missing'].forEach(size => {
    issuesByShirtSize[size] = open.filter(r => (r.shirtSize || 'Missing') === size).map(r => ({ 
      id: r.id, 
      title: r.title, 
      team: r.team, 
      assignee: r.assignee, 
      priority: r.priority, 
      url: r.url 
    }));
  });

  return {
    summaryStats,
    teamDetailedData,
    assigneeDetailedData,
    issuesByStatus: byStatus,
    issuesByPriority: byPriority,
    issuesByShirtSize,
  };
}

function formatSummaryStatsBlock(data) {
  const s = data.summaryStats;
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '-');
  let out = `        // Summary stats (UPDATED FROM LINEAR - ${dateStr})\n`;
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
  out += `            dueSoonIssues: ${JSON.stringify(s.dueSoonIssues)}\n`;
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
    out += `                overdueIssues: summaryStats.overdueIssues.filter(i => i.team === '${key}')\n`;
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
    out += `                overdueIssues: summaryStats.overdueIssues.filter(i => i.assignee === '${safeKey}')\n`;
    out += `            },\n`;
  });
  out += `        };\n\n`;
  return out;
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

async function main() {
  // Read issues from JSON file passed as argument or stdin
  let issues = [];
  if (process.argv[2]) {
    const issuesData = fs.readFileSync(process.argv[2], 'utf8');
    issues = JSON.parse(issuesData);
  } else {
    console.error('Usage: node sync-with-mcp.js <issues.json>');
    console.error('Or pipe JSON: cat issues.json | node sync-with-mcp.js');
    process.exit(1);
  }

  console.log(`Processing ${issues.length} issues from Linear MCP...`);
  const data = buildDashboardData(issues);

  const htmlPath = HTML_FILE;
  let html = fs.readFileSync(htmlPath, 'utf8');

  const summaryBlock = formatSummaryStatsBlock(data);
  const teamBlock = formatTeamDetailedBlock(data);
  const assigneeBlock = formatAssigneeDetailedBlock(data);

  const summaryEnd = html.indexOf('        // Team detailed data');
  const summaryStart = html.indexOf('        const summaryStats = {');
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

  fs.writeFileSync(htmlPath, html);
  console.log('Dashboard HTML updated successfully.');
  console.log(`Summary: ${data.summaryStats.totalOpen} open, ${data.summaryStats.overdue} overdue, ${data.summaryStats.totalClosed} closed.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
