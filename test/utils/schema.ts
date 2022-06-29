/*!
 * © 2021 Atypon Systems LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { Mark, Node as PMNode, Schema } from 'prosemirror-model'
import { bulletList, listItem, orderedList } from 'prosemirror-schema-list'

import { TrackedAttrs } from '../../src'

export type Nodes =
  | 'blockquote'
  | 'code_block'
  | 'doc'
  | 'hard_break'
  | 'heading'
  | 'horizontal_rule'
  | 'image'
  | 'paragraph'
  | 'text'
  | 'ordered_list'
  | 'bullet_list'
  | 'list_item'
  | 'table'
  | 'table_body'
  | 'table_colgroup'
  | 'table_row'
  | 'table_cell'
  | 'table_col'

export type Marks =
  | 'bold'
  | 'code'
  | 'italic'
  | 'link'
  | 'strikethrough'
  | 'tracked_insert'
  | 'tracked_delete'

export type ExampleSchema = Schema<Nodes, Marks>

function add(obj: Record<string, any>, props: Record<string, any>) {
  const copy: Record<string, any> = {}
  for (const prop in obj) {
    copy[prop] = obj[prop]
  }
  for (const prop in props) {
    copy[prop] = props[prop]
  }
  return copy
}

const getCellAttrs = (p: Node | string) => {
  const dom = p as HTMLTableCellElement

  const celltype = dom.tagName.toLowerCase()
  const colspan = Number(dom.getAttribute('colspan') || 1)

  return {
    celltype,
    colspan,
    rowspan: Number(dom.getAttribute('rowspan') || 1),
    placeholder: dom.getAttribute('data-placeholder-text') || '',
  }
}

// From https://github.com/ProseMirror/prosemirror-schema-basic/blob/master/src/schema-basic.js
export const schema: ExampleSchema = new Schema<Nodes, Marks>({
  nodes: {
    // :: NodeSpec The top level document node.
    doc: {
      content: 'block+',
    },

    // :: NodeSpec A plain paragraph textblock. Represented in the DOM
    // as a `<p>` element.
    paragraph: {
      content: 'inline*',
      group: 'block',
      attrs: { dataTracked: { default: null }, testAttribute: { default: null } },
      parseDOM: [{ tag: 'p' }],
      toDOM() {
        return ['p', 0]
      },
    },

    // :: NodeSpec A blockquote (`<blockquote>`) wrapping one or more blocks.
    blockquote: {
      content: 'block+',
      group: 'block',
      defining: true,
      attrs: { dataTracked: { default: null } },
      parseDOM: [{ tag: 'blockquote' }],
      toDOM() {
        return ['blockquote', 0]
      },
    },

    // :: NodeSpec A horizontal rule (`<hr>`).
    horizontal_rule: {
      group: 'block',
      attrs: { dataTracked: { default: null } },
      parseDOM: [{ tag: 'hr' }],
      toDOM() {
        return ['hr']
      },
    },

    // :: NodeSpec A heading textblock, with a `level` attribute that
    // should hold the number 1 to 6. Parsed and serialized as `<h1>` to
    // `<h6>` elements.
    heading: {
      content: 'inline*',
      group: 'block',
      defining: true,
      attrs: { level: { default: 1 }, dataTracked: { default: null } },
      parseDOM: [
        { tag: 'h1', attrs: { level: 1 } },
        { tag: 'h2', attrs: { level: 2 } },
        { tag: 'h3', attrs: { level: 3 } },
        { tag: 'h4', attrs: { level: 4 } },
        { tag: 'h5', attrs: { level: 5 } },
        { tag: 'h6', attrs: { level: 6 } },
      ],
      toDOM(node: PMNode) {
        return ['h' + node.attrs.level, 0]
      },
    },

    // :: NodeSpec A code listing. Disallows marks or non-text inline
    // nodes by default. Represented as a `<pre>` element with a
    // `<code>` element inside of it.
    code_block: {
      content: 'text*',
      marks: 'tracked_insert tracked_delete',
      group: 'block',
      code: true,
      defining: true,
      attrs: { dataTracked: { default: null } },
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
      toDOM() {
        return ['pre', ['code', 0]]
      },
    },

    // :: NodeSpec The text node.
    text: {
      group: 'inline',
    },

    // :: NodeSpec An inline image (`<img>`) node. Supports `src`,
    // `alt`, and `href` attributes. The latter two default to the empty
    // string.
    image: {
      inline: true,
      group: 'inline',
      draggable: true,
      attrs: {
        src: {},
        alt: { default: null },
        title: { default: null },
        dataTracked: { default: null },
      },
      parseDOM: [
        {
          tag: 'img[src]',
          getAttrs(dom: HTMLElement | string) {
            if (dom instanceof HTMLElement) {
              return {
                src: dom.getAttribute('src'),
                title: dom.getAttribute('title'),
                alt: dom.getAttribute('alt'),
              }
            }
            return null
          },
        },
      ],
      toDOM(node: PMNode) {
        const { src, alt, title } = node.attrs
        return ['img', { src, alt, title }]
      },
    },

    // :: NodeSpec A hard line break, represented in the DOM as `<br>`.
    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
      attrs: { dataTracked: { default: null } },
      parseDOM: [{ tag: 'br' }],
      toDOM() {
        return ['br']
      },
    },
    ordered_list: add(orderedList, {
      content: 'list_item+',
      group: 'block',
      attrs: { dataTracked: { default: null } },
    }),
    bullet_list: add(bulletList, {
      content: 'list_item+',
      group: 'block',
      attrs: { dataTracked: { default: null } },
    }),
    list_item: add(listItem, {
      content: 'paragraph block*',
      attrs: { dataTracked: { default: null } },
    }),

    table: {
      content: 'table_colgroup? table_body',
      tableRole: 'table',
      isolating: true,
      group: 'block',
      selectable: false,
      attrs: { dataTracked: { default: null } },
      parseDOM: [
        {
          tag: 'table',
        },
      ],
      toDOM: () => {
        return ['table', 0]
      },
    },

    table_body: {
      content: 'table_row{3,}',
      tableRole: 'tbody',
      parseDOM: [
        {
          tag: 'tbody',
        },
      ],
      toDOM() {
        return ['tbody', 0]
      },
    },

    table_colgroup: {
      content: 'table_col+',
      tableRole: 'colgroup',
      attrs: { dataTracked: { default: null } },
      parseDOM: [
        {
          tag: 'colgroup',
        },
      ],
      toDOM() {
        return ['colgroup', 0]
      },
    },

    table_row: {
      content: 'table_cell+',
      tableRole: 'row',
      attrs: { dataTracked: { default: null } },
      parseDOM: [
        {
          tag: 'tr',
          priority: 80,
        },
      ],
      toDOM: () => {
        return ['tr', 0]
      },
    },

    table_cell: {
      content: 'inline*',
      attrs: {
        dataTracked: { default: null },
        celltype: { default: 'td' },
        colspan: { default: 1 },
        rowspan: { default: 1 },
      },
      tableRole: 'cell',
      isolating: true,
      parseDOM: [
        { tag: 'td', getAttrs: getCellAttrs },
        { tag: 'th', getAttrs: getCellAttrs },
      ],
      toDOM: (node: PMNode) => {
        const tableCellNode = node
        const attrs: { [attr: string]: string } = {}
        const tag = tableCellNode.attrs.celltype
        if (tableCellNode.attrs.colspan && tableCellNode.attrs.colspan !== 1) {
          attrs.colspan = String(tableCellNode.attrs.colspan)
        }
        if (tableCellNode.attrs.rowspan && tableCellNode.attrs.rowspan !== 1) {
          attrs.rowspan = String(tableCellNode.attrs.rowspan)
        }
        return [tag, attrs, 0]
      },
    },

    table_col: {
      attrs: {
        dataTracked: { default: null },
        width: { default: '' },
      },
      tableRole: 'col',
      parseDOM: [
        {
          tag: 'col',
          getAttrs: (dom: HTMLElement | string) => {
            if (dom instanceof HTMLElement) {
              return {
                width: dom.getAttribute('width'),
              }
            }
            return null
          },
        },
      ],
      toDOM: (node: PMNode) => {
        const tableColNode = node
        const attrs: { [key: string]: string } = {}
        if (tableColNode.attrs.width) {
          attrs['width'] = tableColNode.attrs.width
        }
        return ['col', attrs]
      },
    },
  },
  marks: {
    // :: MarkSpec A link. Has `href` and `title` attributes. `title`
    // defaults to the empty string. Rendered and parsed as an `<a>`
    // element.
    link: {
      attrs: {
        href: {},
        title: { default: null },
        dataTracked: { default: null },
      },
      inclusive: false,
      parseDOM: [
        {
          tag: 'a[href]',
          getAttrs(dom: HTMLElement | string) {
            if (dom instanceof HTMLElement) {
              return {
                src: dom.getAttribute('src'),
                title: dom.getAttribute('title'),
                alt: dom.getAttribute('alt'),
              }
            }
            return null
          },
        },
      ],
      toDOM(node: Mark) {
        const { href, title } = node.attrs
        return ['a', { href, title }, 0]
      },
    },

    // :: MarkSpec An emphasis mark. Rendered as an `<em>` element.
    // Has parse rules that also match `<i>` and `font-style: italic`.
    italic: {
      attrs: { dataTracked: { default: null } },
      parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
      toDOM() {
        return ['em', 0]
      },
    },

    // :: MarkSpec A strong mark. Rendered as `<strong>`, parse rules
    // also match `<b>` and `font-weight: bold`.
    bold: {
      attrs: { dataTracked: { default: null } },
      parseDOM: [
        { tag: 'strong' },
        // This works around a Google Docs misbehavior where
        // pasted content will be inexplicably wrapped in `<b>`
        // tags with a font-weight normal.
        {
          tag: 'b',
          getAttrs: (dom: HTMLElement | string) => {
            if (dom instanceof HTMLElement) {
              return dom.style.fontWeight !== 'normal' && null
            }
            return null
          },
        },
        {
          style: 'font-weight',
          getAttrs: (dom: HTMLElement | string) => {
            if (typeof dom === 'string') {
              return /^(bold(er)?|[5-9]\d{2,})$/.test(dom) && null
            }
            return null
          },
        },
      ],
      toDOM() {
        return ['strong', 0]
      },
    },

    // :: MarkSpec Code font mark. Represented as a `<code>` element.
    code: {
      attrs: { dataTracked: { default: null } },
      parseDOM: [{ tag: 'code' }],
      toDOM() {
        return ['code', 0]
      },
    },

    strikethrough: {
      attrs: { dataTracked: { default: null } },
      parseDOM: [
        { tag: 's' },
        { tag: 'strike' },
        { style: 'text-decoration=line-through' },
        { style: 'text-decoration-line=line-through' },
      ],
      toDOM: () => ['s'],
    },

    tracked_insert: {
      excludes: 'tracked_insert tracked_delete',
      attrs: {
        dataTracked: { default: null },
      },
      parseDOM: [{ tag: 'ins' }],
      toDOM: (el: Mark) => {
        const dataTracked: TrackedAttrs | undefined = el.attrs.dataTracked
        const { status = 'pending' } = dataTracked || {}
        const attrs = {
          class: `inserted ${status}`,
        }
        return ['ins', attrs]
      },
    },

    tracked_delete: {
      excludes: 'tracked_insert tracked_delete',
      attrs: {
        dataTracked: { default: null },
      },
      parseDOM: [{ tag: 'del' }],
      toDOM: (el: Mark) => {
        const dataTracked: TrackedAttrs | undefined = el.attrs.dataTracked
        const { status = 'pending' } = dataTracked || {}
        const attrs = {
          class: `deleted ${status}`,
        }
        return ['del', attrs]
      },
    },
  },
})
