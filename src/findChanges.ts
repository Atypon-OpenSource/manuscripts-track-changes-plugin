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
import { ChangeSet } from './ChangeSet'
import {
  IncompleteChange,
  MarkChange,
  PartialChange,
  TextChange,
  CHANGE_OPERATION,
  NodeAttrChange,
  ReferenceChange,
  NodeChange,
} from './types/change'
import { getMarkTrackedData, getNodeTrackedData } from './helpers/attributes'

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
  // Store the last iterated change to join adjacent text changes
  let current: { change: IncompleteChange; node: PMNode } | undefined
  state.doc.descendants((node, pos) => {
    const tracked = getNodeTrackedData(node, state.schema) || []

    const marksWithTrackChanges = getMarkTrackedData(node)
    marksWithTrackChanges?.forEach((trackAttrs, mark) => {
      trackAttrs.forEach((c) => {
        const ch = {
          id: c.id,
          type: 'mark-change',
          from: pos,
          to: pos + node.nodeSize,
          dataTracked: { ...c },
          nodeType: node.type,
          node: node,
          mark: mark,
        } as MarkChange
        changes.push(ch)
      })
    })

    for (let i = 0; i < tracked.length; i += 1) {
      const dataTracked = tracked[i]
      const id = dataTracked.id || ''
      if (current && current.change.id === id) {
        current.change.to = pos + node.nodeSize
        // Important to update the node as the text changes might contain multiple parts where some marks equal each other
        current.node = node
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
          dataTracked: { ...dataTracked },
          text: node.text,
          nodeType: node.type,
        } as PartialChange<TextChange>
      } else if (dataTracked.operation === CHANGE_OPERATION.set_node_attributes) {
        change = {
          id,
          type: 'node-attr-change',
          from: pos,
          to: pos + node.nodeSize,
          dataTracked: { ...dataTracked },
          node: node,
          newAttrs: { ...node.attrs },
          oldAttrs: { ...dataTracked.oldAttrs },
        } as NodeAttrChange
      } else if (dataTracked.operation === CHANGE_OPERATION.reference) {
        change = {
          id,
          type: 'reference-change',
          from: pos,
          to: pos + node.nodeSize,
          dataTracked,
        } as ReferenceChange
      } else {
        change = {
          id,
          type: 'node-change',
          from: pos,
          to: pos + node.nodeSize,
          dataTracked: { ...dataTracked },
          node: node,
          children: [],
          attrs: { ...node.attrs },
        } as PartialChange<NodeChange>
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
