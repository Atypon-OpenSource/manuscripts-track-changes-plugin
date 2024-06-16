/*!
 * © 2023 Atypon Systems LLC
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
import { Node as PMNode } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'

import { ChangeSet } from '../ChangeSet'
import { equalMarks, getNodeTrackedData } from '../compute/nodeHelpers'
import {
  CHANGE_OPERATION,
  ColumnChange,
  IncompleteChange,
  NodeAttrChange,
  NodeChange,
  PartialChange,
  TextChange,
} from '../types/change'

/**
 * Finds all changes (basically text marks or node attributes) from document
 *
 * This could be possibly made more efficient by only iterating the sections of doc where changes have
 * been applied. This could attempted with eg findDiffStart but it might be less robust than just using
 * doc.descendants
 * @param state
 * @returns
 */
export function findChanges(state: EditorState) {
  const changes: IncompleteChange[] = []
  const columnChanges = new Map<string, number>()
  // Store the last iterated change to join adjacent text changes
  let current: { change: IncompleteChange; node: PMNode } | undefined
  state.doc.descendants((node, pos) => {
    const tracked = getNodeTrackedData(node, state.schema) || []

    for (let i = 0; i < tracked.length; i += 1) {
      const dataTracked = tracked[i]
      const id = dataTracked.id || ''
      // Join adjacent text changes that have been broken up due to different marks
      // eg <ins><b>bold</b>norm<i>italic</i></ins> -> treated as one continuous change
      // Note the !equalMarks to leave changes separate incase the marks are equal to let fixInconsistentChanges to fix them
      if (
        current &&
        current.change.id === id &&
        current.node.isText &&
        node.isText &&
        !equalMarks(node, current.node)
      ) {
        current.change.to = pos + node.nodeSize
        // Important to update the node as the text changes might contain multiple parts where some marks equal each other
        current.node = node
        continue
      }

      if (node.type === node.type.schema.nodes.table && dataTracked.column_change_id) {
        changes.push({
          id,
          type: 'column-change',
          tablePosition: pos,
          from: 0,
          to: 0,
          dataTracked,
          nodeType: 'table_column',
          children: [],
        } as PartialChange<ColumnChange>)
        columnChanges.set(dataTracked.column_change_id, changes.length - 1)
        continue
      }

      current && changes.push(current.change)
      let change
      if (node.isText) {
        change = {
          id,
          type: 'text-change',
          from: pos,
          to: pos + node.nodeSize,
          dataTracked,
          text: node.text,
        } as PartialChange<TextChange>
      } else if (dataTracked.operation === CHANGE_OPERATION.set_node_attributes) {
        change = {
          id,
          type: 'node-attr-change',
          from: pos,
          to: pos + node.nodeSize,
          dataTracked,
          nodeType: node.type.name,
          newAttrs: node.attrs,
          oldAttrs: dataTracked.oldAttrs,
        } as NodeAttrChange
      } else {
        change = {
          id,
          type: 'node-change',
          from: pos,
          to: pos + node.nodeSize,
          dataTracked,
          nodeType: node.type.name,
          children: [],
        } as PartialChange<NodeChange>
      }

      if (dataTracked.column_change_id && dataTracked.operation !== CHANGE_OPERATION.set_node_attributes) {
        const columnChange = changes[
          columnChanges.get(dataTracked.column_change_id) as number
        ] as ColumnChange
        if (columnChange && node.type.schema.nodes.table_row.contentMatch.matchType(node.type)) {
          // position of first cell in column
          if (!columnChange.from) {
            columnChange.from = pos
          }
          // position of last cell in column
          columnChange.to = pos
        }
      }

      current = {
        change,
        node,
      }
    }
    if (tracked.length === 0 && current) {
      changes.push(current.change)
      current = undefined
    }
  })
  current && changes.push(current.change)
  return new ChangeSet(changes)
}
