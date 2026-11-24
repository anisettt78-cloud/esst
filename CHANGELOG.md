# Changelog

## 4.0.0 — Stage 9 (chat) + Stage 10 (polish, docs)
- **Chat pages**: inbox (`#/chat`) and conversation (`#/chat/:id`): text, voice notes, photos, shared match/player/team cards,
  delete own messages, read ticks (group chats: "Read by n of m"), block / unblock, load older messages, unread badge
  (bottom bar on phones, top links on desktop).
- **Live delivery**: Server-Sent Events read with `fetch` (the Authorization header works), automatic reconnect with back-off,
  catch-up after a gap, polling fallback every 5 s when streaming is blocked.
- **"Send in chat"** button on player, match and team pages (the team page also got a normal Share button).
- Conversation layout: only the message list scrolls, composer stays above the phone keyboard, bottom bar hidden inside a chat,
  RTL mirrored, every control >= 44 px.
- Private media (voice, photos) is fetched with the login header and released from memory when you leave the conversation.
- 80 new texts in English, French and Arabic.
- `scripts/verify-db.js` (+ `npm run verify-db`): real-database check, rolled back.
- Accessibility pass (WCAG AA): chat colours in the light theme and the input placeholder now reach 4.5:1 contrast; keyboard order, focus rings, Escape-closes-dialog and accessible names verified.
- 6 new server tests for the live stream on the real server code (headers, CORS from a double-clicked file, auth, per-person delivery, 5-connection cap, token expiry, cleanup).
- README rewritten; viewport meta `interactive-widget=resizes-content` so Android keyboards resize the page.
