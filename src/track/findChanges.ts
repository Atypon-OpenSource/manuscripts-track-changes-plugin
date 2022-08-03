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
import { EditorState } from 'prosemirror-state'
import { Node as PMNode } from 'prosemirror-model'

import { ChangeSet } from '../ChangeSet'
import { IncompleteChange, NodeChange, PartialChange, TextChange } from '../types/change'
import { getNodeTrackedData, equalMarks } from './node-utils'

/**
 * Finds all changes (basically text marks or node attributes) from document
 *
 * This could be possibly made more efficient by only iterating the sections of doc
 * where changes have been applied. This could attempted with eg findDiffStart
 * but it might be less robust than just using doc.descendants
 * @param state
 * @returns
 */
export function findChanges(state: EditorState) {
  const changes: IncompleteChange[] = []
  // Store the last iterated change to join adjacent text changes
  let current: { change: IncompleteChange; node: PMNode } | undefined
  state.doc.descendants((node, pos) => {
    const attrs = getNodeTrackedData(node, state.schema)
    if (attrs) {
      const id = attrs?.id || ''
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
      } else if (node.isText) {
        current && changes.push(current.change)
        current = {
          change: {
            id,
            type: 'text-change',
            from: pos,
            to: pos + node.nodeSize,
            text: node.text,
            attrs,
          } as PartialChange<TextChange>,
          node,
        }
      } else {
        current && changes.push(current.change)
        current = {
          change: {
            id,
            type: 'node-change',
            from: pos,
            to: pos + node.nodeSize,
            nodeType: node.type.name,
            children: [],
            attrs,
          } as PartialChange<NodeChange>,
          node,
        }
      }
    } else if (current) {
      changes.push(current.change)
      current = undefined
    }
  })
  current && changes.push(current.change)
  return new ChangeSet(changes)
}
