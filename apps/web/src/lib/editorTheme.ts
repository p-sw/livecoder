import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// ponytail: one accent palette, hand-mapped to lezer tag names. We avoid
// importing a full theme package — the existing dark scheme already has
// the colors we need (--accent, --blue, --purple, --orange, --danger).
const colors = {
  bg: '#0b1119',
  gutterBg: '#0e151e',
  gutterFg: '#3f5260',
  activeLine: '#101a26',
  selection: 'rgba(141,244,189,.18)',
  selectionBlur: 'rgba(141,244,189,.09)',
  cursor: '#8df4bd',
  border: '#202d3a',
  foreground: '#e7eef4',
  muted: '#8695a3',
  keyword: '#c4a4ff',
  string: '#b1f8d0',
  number: '#ffbd73',
  bool: '#ff8d9b',
  comment: '#526170',
  tag: '#80b8ff',
  attr: '#c4a4ff',
  property: '#8df4bd',
  operator: '#8695a3',
  punct: '#667887',
  func: '#80b8ff',
  type: '#ffbd73',
  meta: '#526170',
  invalid: '#ff8d9b',
};

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: colors.keyword, fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: colors.string },
  { tag: t.number, color: colors.number },
  { tag: [t.bool, t.null], color: colors.bool },
  { tag: [t.lineComment, t.blockComment], color: colors.comment, fontStyle: 'italic' },
  { tag: [t.docComment], color: colors.comment, fontStyle: 'italic' },
  { tag: [t.tagName], color: colors.tag },
  { tag: [t.propertyName], color: colors.property },
  { tag: [t.operator, t.punctuation, t.bracket, t.angleBracket, t.paren, t.brace, t.squareBracket], color: colors.punct },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: colors.func },
  { tag: [t.typeName, t.className, t.namespace], color: colors.type },
  { tag: [t.variableName, t.constant(t.variableName)], color: colors.foreground },
  { tag: [t.heading], color: colors.keyword, fontWeight: '700' },
  { tag: [t.link, t.url], color: colors.tag, textDecoration: 'underline' },
  { tag: [t.meta, t.annotation], color: colors.meta },
  { tag: [t.invalid], color: colors.invalid },
  { tag: t.atom, color: colors.bool },
  { tag: t.processingInstruction, color: colors.meta },
]);

export const editorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: colors.bg,
      color: colors.foreground,
      fontSize: '13px',
      fontFamily: 'var(--mono)',
    },
    '.cm-scroller': {
      fontFamily: 'var(--mono)',
      lineHeight: '1.55',
    },
    '.cm-content': {
      caretColor: colors.cursor,
      padding: '8px 0',
    },
    '.cm-line': { padding: '0 14px' },
    '.cm-gutters': {
      backgroundColor: colors.gutterBg,
      color: colors.gutterFg,
      border: 'none',
      borderRight: `1px solid ${colors.border}`,
    },
    '.cm-activeLineGutter': { backgroundColor: colors.activeLine, color: colors.muted },
    '.cm-activeLine': { backgroundColor: colors.activeLine },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: colors.cursor, borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: colors.selection },
    '&.cm-focused ::selection': { backgroundColor: colors.selection },
    '.cm-selectionMatch': { backgroundColor: colors.selectionBlur },
    '.cm-searchMatch': { backgroundColor: 'rgba(255,189,115,.25)', outline: '1px solid rgba(255,189,115,.5)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(255,189,115,.4)' },
    '.cm-matchingBracket, .cm-nonmatchingBracket': { outline: '1px solid transparent', color: colors.func },
    '.cm-nonmatchingBracket': { color: colors.invalid },
    '.cm-tooltip': {
      backgroundColor: colors.gutterBg,
      color: colors.foreground,
      border: `1px solid ${colors.border}`,
      borderRadius: '6px',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: colors.activeLine,
      color: colors.foreground,
    },
    '.cm-panels': {
      backgroundColor: colors.gutterBg,
      color: colors.foreground,
      borderTop: `1px solid ${colors.border}`,
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'rgba(141,244,189,.07)',
      color: colors.muted,
      border: '1px solid transparent',
      borderRadius: '4px',
      padding: '0 6px',
    },
  },
  { dark: true },
);

export const editorHighlight = syntaxHighlighting(highlight);
