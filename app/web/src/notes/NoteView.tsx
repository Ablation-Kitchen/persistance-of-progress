import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface MdNode {
  type: string;
  children?: MdNode[];
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

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

/** Rendered Markdown for Notes and Task text: GFM tables, task lists, autolinks. */
export function NoteView({ body }: { body: string }) {
  return (
    <div className="note-view">
      <Markdown remarkPlugins={[remarkGfm, htmlAsText]} components={components}>
        {body}
      </Markdown>
    </div>
  );
}
