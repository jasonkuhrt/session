import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

/** The Markdown reader the board renders with: react-markdown's parser, with the board's one plugin. */
export const markdown = unified().use(remarkParse).use(remarkGfm);

/** What the server reads of a parsed node: its kind, its text, what it holds, and where it sits. */
export type MarkdownNode = {
  readonly type: string;
  /** The words of a text node and the code of a code node. */
  readonly value?: string | undefined;
  /** What an image says in place of itself. */
  readonly alt?: string | null | undefined;
  readonly children?: ReadonlyArray<MarkdownNode> | undefined;
  readonly position?:
    | { readonly start: { readonly line: number }; readonly end: { readonly line: number } }
    | undefined;
};
