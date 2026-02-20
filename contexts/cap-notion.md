---
name: cap-notion
type: capability
---
# Notion — Setup Guide

Read and write Notion pages and databases via REST API.

## What You Need
- `notion_api_key` credential — from a Notion integration

## Setup Steps
1. User creates an integration at notion.so/my-integrations
2. Copy the Internal Integration Secret
3. Store: `store_credential("notion_api_key", "secret_...")`
4. User must share specific pages/databases with the integration in Notion

## Custom Tools to Build
- `query_notion_db(database_id, filter)` — query a database
- `read_notion_page(page_id)` — read page content
- `create_notion_page(database_id, properties)` — create a page

All use Notion REST API v2022-06-28:
- Base URL: `https://api.notion.com/v1/`
- Headers: `Authorization: Bearer {key}`, `Notion-Version: 2022-06-28`
- Use `get_credential("notion_api_key")` inside tools

Or tell the user to run: `claw setup notion`
