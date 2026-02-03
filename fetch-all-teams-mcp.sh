#!/bin/bash
# Script to fetch issues from all teams using Linear MCP
# This script should be run from Cursor with MCP access

echo "This script needs to be run from Cursor with MCP Linear access."
echo "It will fetch issues from: Comp-leg, FCP, LTO, RPA, and PGA"
echo ""
echo "To use this, you need to:"
echo "1. Use Cursor's MCP Linear tools to fetch issues for each team"
echo "2. Save the results to JSON files"
echo "3. Combine them and run: node sync-linear-to-dashboard.js combined.json"
