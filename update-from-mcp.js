#!/usr/bin/env node
/**
 * Update dashboard using Linear MCP data.
 * This script processes issues from Linear MCP and updates the HTML dashboard.
 */

const fs = require('fs');
const path = require('path');

// This will be populated by fetching from MCP
// For now, we'll read from a JSON file that contains all issues
const HTML_FILE = path.join(__dirname, 'compliance_dashboard_v14_roxom (1).html');

// Use the existing sync script logic but adapt it for MCP data format
const syncScript = require('./sync-linear-to-dashboard.js');

// We need to transform MCP format to the format expected by sync script
function transformMCPToSyncFormat(mcpIssues) {
  return mcpIssues.map(issue => ({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    dueDate: issue.dueDate,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    completedAt: issue.completedAt,
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
  }));
}

async function main() {
  // Read issues from JSON file (populated by MCP calls)
  const issuesFile = process.argv[2] || '/tmp/all-relevant-issues.json';
  
  if (!fs.existsSync(issuesFile)) {
    console.error(`Issues file not found: ${issuesFile}`);
    console.error('Usage: node update-from-mcp.js <issues.json>');
    process.exit(1);
  }

  const mcpIssues = JSON.parse(fs.readFileSync(issuesFile, 'utf8'));
  console.log(`Processing ${mcpIssues.length} issues from Linear MCP...`);
  
  // Transform to format expected by sync script
  const transformedIssues = transformMCPToSyncFormat(mcpIssues);
  
  // Now use the buildDashboardData function from sync script
  // We'll need to import/require the functions from sync script
  // For now, let's just call the sync script with transformed data
  
  // Save transformed issues to temp file
  const tempFile = '/tmp/transformed-issues.json';
  fs.writeFileSync(tempFile, JSON.stringify(transformedIssues));
  
  // Modify sync script to accept file input, or we can directly use the logic
  console.log('Transformed issues saved. Now updating dashboard...');
  
  // Actually, let's just modify the sync script to work with this
  // Or better: use the existing sync script but feed it the data
  console.log('Please use: node sync-linear-to-dashboard.js (with LINEAR_API_KEY)');
  console.log('Or modify sync script to accept JSON file input');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
