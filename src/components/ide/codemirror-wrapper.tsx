'use client';

import React, { useMemo } from 'react';
import CodeMirror, { type Extension } from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { indentWithTab } from '@codemirror/commands';
import { keymap } from '@codemirror/view';

export interface CodeMirrorWrapperProps {
  value: string;
  onChange?: (val: string) => void;
  onBlur?: () => void;
  readOnly?: boolean;
  filePath: string;
}

/**
 * Returns syntax highlighting extension based on file path extension.
 */
function getLanguageExtension(path: string): Extension[] {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'html':
    case 'htm':
      return [html()];
    case 'css':
    case 'scss':
      return [css()];
    case 'js':
    case 'jsx':
      return [javascript({ jsx: true, typescript: false })];
    case 'ts':
    case 'tsx':
      return [javascript({ jsx: true, typescript: true })];
    case 'json':
      return [json()];
    case 'md':
    case 'markdown':
      return [markdown()];
    case 'py':
      return [python()];
    default:
      return [];
  }
}

/**
 * DESYRA Dark Theme matching design tokens:
 * Surface: #111114, Text: #F4F4F5, Muted: #A1A1AA, Caret: #FF6B1A, Selection: accent-soft
 */
const desyraTheme = EditorView.theme(
  {
    '&': {
      color: '#F4F4F5',
      backgroundColor: '#111114',
      fontSize: '14px',
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      height: '100%',
    },
    '.cm-scroller': {
      fontFamily: 'inherit',
      lineHeight: '1.6',
      overflow: 'auto',
      touchAction: 'pan-x pan-y',
    },
    '.cm-content': {
      caretColor: '#FF6B1A',
      padding: '12px 0',
      minHeight: '100%',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#FF6B1A',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(255, 107, 26, 0.22) !important',
    },
    '.cm-gutters': {
      backgroundColor: '#111114',
      color: '#5B5B63',
      borderRight: '1px solid #26262C',
      paddingRight: '8px',
      userSelect: 'none',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: '#A1A1AA',
      fontWeight: '600',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
    },
    '.cm-matchingBracket': {
      backgroundColor: 'rgba(255, 107, 26, 0.25)',
      color: '#FF8240 !important',
      outline: '1px solid #FF6B1A',
    },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(245, 183, 59, 0.3)',
      outline: '1px solid #F5B73B',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgba(255, 107, 26, 0.4)',
    },
    '.cm-panels': {
      backgroundColor: '#18181C',
      color: '#F4F4F5',
      borderBottom: '1px solid #26262C',
    },
  },
  { dark: true }
);

export interface CodeMirrorWrapperProps {
  value: string;
  onChange?: (val: string) => void;
  onBlur?: () => void;
  readOnly?: boolean;
  filePath: string;
  onAppendChunkRef?: React.MutableRefObject<((chunk: string) => void) | null>;
}

export function CodeMirrorWrapper({
  value,
  onChange,
  onBlur,
  readOnly = false,
  filePath,
  onAppendChunkRef,
}: CodeMirrorWrapperProps) {
  const viewRef = React.useRef<EditorView | null>(null);
  const langExtension = useMemo(() => getLanguageExtension(filePath), [filePath]);

  React.useEffect(() => {
    if (onAppendChunkRef) {
      onAppendChunkRef.current = (chunk: string) => {
        const view = viewRef.current;
        if (!view || !chunk) return;
        const len = view.state.doc.length;
        const scrollEl = view.scrollDOM;
        const isNearBottom =
          scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight <= 60;

        view.dispatch({
          changes: { from: len, insert: chunk },
          effects: isNearBottom ? EditorView.scrollIntoView(len + chunk.length) : undefined,
        });
      };
    }
    return () => {
      if (onAppendChunkRef) {
        onAppendChunkRef.current = null;
      }
    };
  }, [onAppendChunkRef]);

  const extensions = useMemo(() => {
    return [
      desyraTheme,
      keymap.of([indentWithTab]),
      ...langExtension,
    ];
  }, [langExtension]);

  return (
    <div className="w-full h-full min-h-0 min-w-0 overflow-hidden flex flex-col">
      <CodeMirror
        value={value}
        height="100%"
        theme="dark"
        extensions={extensions}
        editable={!readOnly}
        readOnly={readOnly}
        onChange={onChange}
        onBlur={onBlur}
        onCreateEditor={(view) => {
          viewRef.current = view;
        }}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightSpecialChars: true,
          history: true,
          foldGutter: false,
          drawSelection: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          syntaxHighlighting: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false,
          rectangularSelection: true,
          crosshairCursor: false,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          closeBracketsKeymap: true,
          defaultKeymap: true,
          searchKeymap: true,
          historyKeymap: true,
          foldKeymap: false,
          completionKeymap: false,
          lintKeymap: false,
        }}
        className="w-full h-full min-h-0 text-[14px]"
      />
    </div>
  );
}
