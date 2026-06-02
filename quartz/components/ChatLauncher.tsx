// @ts-ignore
import chatScript from "./scripts/chatLauncher.inline"
import styles from "./styles/chatLauncher.scss"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

// A fixed bottom chat bar injected into every wiki page. Lets the reader jump
// straight into the conversation from the page they're viewing (see
// scripts/chatLauncher.inline.ts).
const ChatLauncher: QuartzComponent = ({ displayClass }: QuartzComponentProps) => {
  return (
    <div class={classNames(displayClass, "chat-launcher")}>
      <input
        class="chat-launcher-input"
        type="text"
        placeholder="이 페이지에 대해 대화하기…"
        aria-label="이 페이지에 대해 대화하기"
      />
      <button class="chat-launcher-send" aria-label="대화 보내기">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m5 12 7-7 7 7" />
          <path d="M12 19V5" />
        </svg>
      </button>
    </div>
  )
}

ChatLauncher.afterDOMLoaded = chatScript
ChatLauncher.css = styles

export default (() => ChatLauncher) satisfies QuartzComponentConstructor
