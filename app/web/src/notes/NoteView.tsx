import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string };
}

/** Raw HTML in a Note is shown as text, never rendered (spec §7.6). */
function htmlAsText() {
  const walk = (node: MdNode) => {
    for (const child of node.children ?? []) {
      if (child.type === "html") child.type = "text";
      walk(child);
    }
  };
  return walk;
}

/** Wrap case-insensitive matches of `q` in text nodes with `<mark>` (search highlighting). */
function highlightText(q: string) {
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const walk = (node: MdNode) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child): MdNode[] => {
      if (child.type !== "text" || !child.value) {
        walk(child);
        return [child];
      }
      // With a capture group, `split` puts the matches at the odd indices.
      return child.value
        .split(re)
        .map((part, i): MdNode =>
          i % 2 === 1
            ? { type: "mark", data: { hName: "mark" }, children: [{ type: "text", value: part }] }
            : { type: "text", value: part },
        )
        .filter((n) => n.type === "mark" || n.value !== "");
    });
  };
  return () => walk;
}

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

/** Rendered Markdown for Notes and Task text: GFM tables, task lists, autolinks. */
export function NoteView({ body, highlight }: { body: string; highlight?: string }) {
  const q = highlight?.trim();
  const plugins = q ? [remarkGfm, htmlAsText, highlightText(q)] : [remarkGfm, htmlAsText];
  return (
    <div className="note-view">
      <Markdown remarkPlugins={plugins} components={components}>
        {body}
      </Markdown>
    </div>
  );
}
