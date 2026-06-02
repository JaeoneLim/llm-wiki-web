import { StaticResources } from "../util/resources"
import { FilePath, FullSlug } from "../util/path"
import { BuildCtx } from "../util/ctx"

export function getStaticResourcesFromPlugins(ctx: BuildCtx) {
  const staticResources: StaticResources = {
    css: [],
    js: [],
    additionalHead: [],
  }

  for (const transformer of [...ctx.cfg.plugins.transformers, ...ctx.cfg.plugins.emitters]) {
    const res = transformer.externalResources ? transformer.externalResources(ctx) : {}
    if (res?.js) {
      staticResources.js.push(...res.js)
    }
    if (res?.css) {
      staticResources.css.push(...res.css)
    }
    if (res?.additionalHead) {
      staticResources.additionalHead.push(...res.additionalHead)
    }
  }

  // if serving locally, listen for rebuilds and reload the page
  if (ctx.argv.serve) {
    const wsUrl = ctx.argv.remoteDevHost
      ? `wss://${ctx.argv.remoteDevHost}:${ctx.argv.wsPort}`
      : `ws://localhost:${ctx.argv.wsPort}`

    staticResources.js.push({
      loadTime: "afterDOMReady",
      contentType: "inline",
      script: `
        // Guard so SPA soft-navigations don't open a second socket (which would
        // accumulate listeners and multiply reloads). One socket per page load.
        if (!window.__wikiLiveReload) {
          window.__wikiLiveReload = true
          const socket = new WebSocket('${wsUrl}')
          // Coalesce rapid rebuild notifications (e.g. an agent writing several
          // wiki files in a row) into a single refresh, and prefer SPA micromorph
          // navigation so the page updates in place — no white flash, no scroll
          // jump. Fall back to a hard reload. reload(true) refetches images/scripts.
          let __wikiReloadTimer
          const refresh = () => {
            if (typeof window.spaNavigate === 'function') {
              try { window.spaNavigate(new URL(window.location.toString()), true); return } catch (e) {}
            }
            document.location.reload(true)
          }
          socket.addEventListener('message', () => {
            clearTimeout(__wikiReloadTimer)
            __wikiReloadTimer = setTimeout(refresh, 500)
          })
        }
      `,
    })
  }

  return staticResources
}

export * from "./transformers"
export * from "./filters"
export * from "./emitters"

declare module "vfile" {
  // inserted in processors.ts
  interface DataMap {
    slug: FullSlug
    filePath: FilePath
    relativePath: FilePath
  }
}
