// Mirrors crate::models::ALLOWED_REACTIONS on the server — reactions
// are validated server-side against that exact list, so keep these in
// sync. A larger composer-only palette is fine since typed emoji in
// message content isn't validated (it's just text).

export const REACTION_EMOJI = [
  "👍",
  "👎",
  "❤️",
  "😂",
  "😮",
  "😢",
  "😡",
  "🎉",
  "🔥",
  "👀",
  "🚀",
  "💯",
  "😍",
  "🤔",
  "👏",
  "🙌",
  "✅",
  "❌",
  "💀",
  "🎂",
];

export const COMPOSER_EMOJI = [
  // Smileys & emotion
  "😀",
  "😃",
  "😄",
  "😁",
  "😆",
  "😅",
  "🤣",
  "😂",
  "🙂",
  "🙃",
  "😉",
  "😊",
  "😇",
  "🥰",
  "😍",
  "🤩",
  "😘",
  "😋",
  "😛",
  "😜",
  "🤪",
  "🤑",
  "🤗",
  "🤭",
  "🤫",
  "🤔",
  "🤨",
  "😐",
  "😑",
  "😶",
  "🙄",
  "😏",
  "😒",
  "😴",
  "😪",
  "🤤",
  "😷",
  "🤒",
  "🤕",
  "🤢",
  "🥵",
  "🥶",
  "😳",
  "🤯",
  "😬",
  "😰",
  "😨",
  "😢",
  "😭",
  "😱",
  "😡",
  "😠",
  "🤬",
  "😤",
  "😮",
  "😯",
  "🥳",
  "🥺",
  "😎",
  "🤓",
  // Gestures & people
  "👍",
  "👎",
  "👏",
  "🙌",
  "🙏",
  "💪",
  "🤝",
  "👋",
  "✌️",
  "🤞",
  "👌",
  "🤙",
  "👀",
  "🧠",
  "💅",
  "🕺",
  "💃",
  // Hearts & symbols
  "❤️",
  "🧡",
  "💛",
  "💚",
  "💙",
  "💜",
  "🖤",
  "🤍",
  "💔",
  "💯",
  "✅",
  "❌",
  "⭐",
  "🔥",
  "✨",
  "🎉",
  "🎊",
  "💡",
  "⚡",
  "💀",
  // Animals & nature
  "🐶",
  "🐱",
  "🦊",
  "🐻",
  "🐼",
  "🐸",
  "🐵",
  "🦄",
  "🐢",
  "🐙",
  // Food & drink
  "🍕",
  "🍔",
  "🌮",
  "🍣",
  "🍩",
  "🍪",
  "🍫",
  "☕",
  "🍺",
  "🥂",
  // Activities & objects
  "🎮",
  "🎧",
  "🎸",
  "⚽",
  "🏀",
  "🚀",
  "🛠️",
  "💻",
  "📱",
  "🐛",
];

export function renderEmojiPopover(
  anchor: HTMLElement,
  emojis: string[],
  onPick: (emoji: string) => void,
): void {
  const existing = document.querySelector(".emoji-popover");
  if (existing) {
    existing.remove();
    return;
  }

  const popover = document.createElement("div");
  popover.className = "emoji-popover";

  for (const emoji of emojis) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "emoji-option";
    btn.textContent = emoji;
    btn.addEventListener("click", () => {
      onPick(emoji);
      popover.remove();
    });
    popover.appendChild(btn);
  }

  // Centered in the viewport rather than anchored to the triggering
  // button — anchored positioning here could push the (fairly wide)
  // emoji grid off-screen depending on where the button happened to
  // be, especially near the top or right edge.
  document.body.appendChild(popover);
  popover.style.left = "50%";
  popover.style.top = "50%";
  popover.style.transform = "translate(-50%, -50%)";

  const closeOnOutsideClick = (event: MouseEvent) => {
    const target = event.target as Node;
    // `.contains`, not `!==` — `anchor` usually has its own child
    // elements (an icon), so a click that visually lands back on it
    // (e.g. clicking it again to close) can have `event.target` be
    // one of those children instead of `anchor` itself, which would
    // otherwise make that re-click look like an "outside" click too.
    if (!popover.contains(target) && !anchor.contains(target)) {
      popover.remove();
      document.removeEventListener("click", closeOnOutsideClick, true);
    }
  };
  setTimeout(() => document.addEventListener("click", closeOnOutsideClick, true), 0);
}
