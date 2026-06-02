import { QuartzConfig } from "./quartz/cfg"
import * as Plugin from "./quartz/plugins"

/**
 * Quartz 4 configuration for llm-wiki-web.
 *
 * - Content is the repository root (`-d .` in scripts) so wiki/, index.md,
 *   glossary.md, and similar can be served directly without relocation.
 * - ignorePatterns hides tooling, the chat app, raw sources, and process docs
 *   from the public site. Update this list whenever a new private/tooling area
 *   is added to the repo.
 * - locale: Korean. Bodies are Korean-first per CLAUDE.md §8.
 * - baseUrl: set to the deployment URL once known (see DEPLOY.md). Empty/local
 *   is fine for `npm run wiki:serve`.
 */
const config: QuartzConfig = {
  configuration: {
    pageTitle: "LLM Wiki",
    pageTitleSuffix: "",
    enableSPA: true,
    enablePopovers: true,
    analytics: null,
    locale: "ko-KR",
    // 로컬 기본값. 배포 시 실제 도메인으로 교체 (DEPLOY.md 참조).
    baseUrl: "localhost:8080",
    ignorePatterns: [
      // Tooling
      ".obsidian",
      ".claude",
      ".antigravity",
      ".github",
      ".gemini",
      "node_modules",
      "public",
      ".quartz-cache",
      "quartz",
      // Chat app, reset tooling, and seed baseline (never published)
      "app",
      "app/**",
      "scripts",
      "scripts/**",
      "seed",
      "seed/**",
      // Build artifacts and configs (root-level)
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "globals.d.ts",
      "index.d.ts",
      "quartz.config.ts",
      "quartz.layout.ts",
      "Dockerfile",
      "robots.txt",
      // Private sources (CLAUDE.md §9 internal-source safety)
      "raw/**",
      // Process notes (not knowledge content)
      "CLAUDE.md",
      "ANTIGRAVITY.md",
      "README.md",
      "DEPLOY.md",
      "COLLABORATE.md",
      "log.md",
      "plans/**",
    ],
    defaultDateType: "modified",
    theme: {
      fontOrigin: "googleFonts",
      cdnCaching: true,
      typography: {
        header: "Noto Sans KR",
        body: "Noto Sans KR",
        code: "IBM Plex Mono",
      },
      colors: {
        lightMode: {
          light: "#faf8f8",
          lightgray: "#e5e5e5",
          gray: "#b8b8b8",
          darkgray: "#4e4e4e",
          dark: "#2b2b2b",
          secondary: "#284b63",
          tertiary: "#84a59d",
          highlight: "rgba(143, 159, 169, 0.15)",
          textHighlight: "#fff23688",
        },
        darkMode: {
          light: "#161618",
          lightgray: "#393639",
          gray: "#646464",
          darkgray: "#d4d4d4",
          dark: "#ebebec",
          secondary: "#7b97aa",
          tertiary: "#84a59d",
          highlight: "rgba(143, 159, 169, 0.15)",
          textHighlight: "#b3aa0288",
        },
      },
    },
  },
  plugins: {
    transformers: [
      Plugin.FrontMatter(),
      Plugin.CreatedModifiedDate({
        priority: ["frontmatter", "git", "filesystem"],
      }),
      Plugin.SyntaxHighlighting({
        theme: {
          light: "github-light",
          dark: "github-dark",
        },
        keepBackground: false,
      }),
      Plugin.ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false }),
      Plugin.GitHubFlavoredMarkdown(),
      Plugin.TableOfContents(),
      Plugin.CrawlLinks({ markdownLinkResolution: "relative" }),
      Plugin.Description(),
      Plugin.Latex({ renderEngine: "katex" }),
    ],
    filters: [Plugin.RemoveDrafts()],
    emitters: [
      Plugin.AliasRedirects(),
      Plugin.ComponentResources(),
      Plugin.ContentPage(),
      Plugin.FolderPage(),
      Plugin.TagPage(),
      Plugin.ContentIndex({
        enableSiteMap: true,
        enableRSS: true,
      }),
      Plugin.Assets(),
      Plugin.Static(),
      Plugin.Favicon(),
      Plugin.NotFoundPage(),
      // CustomOgImages slows the build; enable later if needed.
      // Plugin.CustomOgImages(),
    ],
  },
}

export default config
