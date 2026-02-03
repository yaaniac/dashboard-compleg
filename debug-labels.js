#!/usr/bin/env node
/** Debug: log labels and project for first issues from Linear API */
const fs = require('fs');
const path = require('path');

const LINEAR_API = 'https://api.linear.app/graphql';
const API_KEY = process.env.LINEAR_API_KEY;

async function run() {
  const query = `
    query Issues($first: Int!) {
      issues(first: $first) {
        nodes {
          identifier
          title
          team { name }
          labels { nodes { name } }
          project { name }
        }
      }
    }
  `;
  const res = await fetch(LINEAR_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': API_KEY },
    body: JSON.stringify({ query, variables: { first: 20 } }),
  });
  const data = await res.json();
  const nodes = data?.data?.issues?.nodes || [];
  console.log('Sample issues (labels + project):');
  nodes.forEach(n => {
    const labels = (n.labels?.nodes || []).map(l => l.name);
    console.log(n.identifier, '| labels:', labels, '| project:', n.project?.name || null);
  });
  // Show unique label names that contain "group" or "roxom" (case insensitive)
  const allLabels = new Set();
  nodes.forEach(n => (n.labels?.nodes || []).forEach(l => allLabels.add(l.name)));
  const groupLike = [...allLabels].filter(l => /group|roxom|global/i.test(l));
  console.log('\nLabels that look like group:', groupLike);
}

run().catch(e => { console.error(e); process.exit(1); });
