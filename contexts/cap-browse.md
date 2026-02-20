---
name: cap-browse
type: capability
---
# Web Browse — Setup Guide

Fetch and read specific web pages, docs, articles. This is for reading SPECIFIC URLs — NOT for search (use Web Search for that).

## Setup
No API key needed. Build a `browse_url` custom tool yourself:
- Use `fetch(url)` to get the page
- Strip `<script>`, `<style>` tags
- Strip remaining HTML tags
- Decode HTML entities
- Cap output at 5000 chars

## Notes
- This works for static content, docs, articles, APIs
- Does NOT work for JavaScript-rendered SPAs
- Do NOT use this to scrape Google search results
