// Injected into every wiki page. Lets the reader jump straight into the chat
// from the page they're viewing. When embedded in the chat app (iframe), it
// postMessages the parent; when opened standalone, it opens the chat app.
document.addEventListener("nav", () => {
  const input = document.querySelector(".chat-launcher-input") as HTMLInputElement | null
  const sendBtn = document.querySelector(".chat-launcher-send") as HTMLButtonElement | null
  if (!input) return

  const embedded = window.parent && window.parent !== window

  const post = (payload: Record<string, unknown>) => {
    if (embedded) {
      window.parent.postMessage({ source: "llm-wiki-chat", ...payload }, "*")
    } else {
      // Production single-origin: wiki is served under /wiki, chat is at origin root.
      // Dev: wiki is on :8080, chat app is on :3000.
      const prod = location.pathname.startsWith("/wiki")
      const base = prod ? `${location.origin}/` : `${location.protocol}//${location.hostname}:3000/`
      const url = new URL(base)
      if (payload.text) url.searchParams.set("ask", String(payload.text))
      if (payload.title) url.searchParams.set("page", String(payload.title))
      window.open(url.toString(), "_blank")
    }
  }

  const ask = () => {
    const text = input.value.trim()
    post({ type: "ask", text, page: location.pathname, title: document.title })
    input.value = ""
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      ask()
    }
  }
  const onFocus = () => post({ type: "focus", page: location.pathname, title: document.title })

  input.addEventListener("keydown", onKey)
  sendBtn?.addEventListener("click", ask)
  input.addEventListener("focus", onFocus)
  window.addCleanup(() => {
    input.removeEventListener("keydown", onKey)
    sendBtn?.removeEventListener("click", ask)
    input.removeEventListener("focus", onFocus)
  })
})
