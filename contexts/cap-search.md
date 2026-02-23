---
name: cap-search
type: capability
---
# Web Search — Setup Guide

Search the internet for current information, news, research.

## IMPORTANT
You CANNOT scrape Google directly with fetch() — it returns useless HTML/JS. You need a search API.

## Options
1. **Serper** (serper.dev) — free tier, 2500 searches/mo. Store key as `serper_api_key`.
2. **Brave Search** (brave.com/search/api) — free tier, 2000/mo. Store key as `brave_search_key`.

## Setup Steps
1. Ask user which search provider they prefer
2. Guide them to sign up and get an API key
3. Store: `store_credential("serper_api_key", "KEY")` or `store_credential("brave_search_key", "KEY")`
4. Build a `web_search` custom tool:

**Serper:** POST to `https://google.serper.dev/search` with header `X-API-KEY` from `get_credential("serper_api_key")`, body `{q: query}`. Return organic results.

**Brave:** GET `https://api.search.brave.com/res/v1/web/search?q={query}` with header `X-Subscription-Token` from `get_credential("brave_search_key")`. Return results.

Or tell the user to run: `betterbot setup search`
