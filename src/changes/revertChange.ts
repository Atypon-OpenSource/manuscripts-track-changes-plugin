/*!
 * © 2024 Atypon Systems LLC
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
import { ManuscriptNode } from '@manuscripts/transform'
import { Schema, Slice } from 'prosemirror-model'
import { Transaction } from 'prosemirror-state'
import { liftTarget, Mapping, ReplaceAroundStep } from 'prosemirror-transform'

import { ChangeSet } from '../ChangeSet'
import { getBlockInlineTrackedData } from '../compute/nodeHelpers'
import { CHANGE_OPERATION, CHANGE_STATUS, IncompleteChange, NodeChange, TrackedChange } from '../types/change'
import { excludeFromTracked } from '../utils/track-utils'

/**
 *  move split-ed content back to the original node. and will update original node dataTracked in these cases:
 *  * the split-ed node has another split will move split_source attr to the original node.
 *  * remove deleted track attr from original node
 */
export function revertSplitNodeChange(tr: Transaction, change: IncompleteChange, changeSet: ChangeSet) {
  const sourceChange = changeSet.changes.find(
    (c) => c.dataTracked.operation === 'reference' && c.dataTracked.referenceId === change.id
  )!

  const node = tr.doc.nodeAt(tr.mapping.map(change.from)) as ManuscriptNode

  tr.delete(tr.mapping.map(change.from), tr.mapping.map(change.to))
  tr.replaceWith(tr.mapping.map(sourceChange.to - 1), tr.mapping.map(sourceChange.to), node.content)

  if ((change as NodeChange).node.type.name === 'list_item') {
    tr.join(sourceChange.to - 1)
  }

  // in case node split has another split will move source to the above node
  const childSource = changeSet.changes.find(
    (c) => c.from === change.from && c.dataTracked.operation === 'reference'
  )
  if (childSource) {
    const node = tr.doc.nodeAt(tr.mapping.map(sourceChange.from)) as ManuscriptNode
    const data = getBlockInlineTrackedData(node) || []
    const dataTracked = data.map((c) => (c.operation === 'reference' ? childSource.dataTracked : c))
    tr.setNodeMarkup(tr.mapping.map(sourceChange.from), undefined, { ...node.attrs, dataTracked }, node.marks)
  }

  // This will remove delete attr from source node, to avoid conflict with the moved content
  const deleteChange = changeSet.changes.find(
    (c) => c.dataTracked.operation == 'delete' && c.from === sourceChange.from
  )
  if (deleteChange) {
    const node = tr.doc.nodeAt(tr.mapping.map(deleteChange.from)) as ManuscriptNode
    tr.setNodeMarkup(
      tr.mapping.map(deleteChange.from),
      undefined,
      excludeFromTracked(node.attrs.dataTracked, deleteChange.id)
    )
  }
}

export function revertWrapNodeChange(tr: Transaction, change: IncompleteChange, deleteMap: Mapping) {
  const from = tr.mapping.map(change.from)
  const to = tr.mapping.map(change.to)
  const node = tr.doc.nodeAt(from)
  // we use ReplaceAroundStep for inline node, as lift will not work with inline node and will help to get right mapping
  if (node?.isInline) {
    // gapping will be narrow to exclude the wrapped node
    tr.step(new ReplaceAroundStep(from, to, from + 1, to - 1, Slice.empty, 0))
    deleteMap.appendMap(tr.steps[tr.steps.length - 1].getMap())
  } else {
    tr.doc.nodesBetween(from, to, (node, pos) => {
      const $fromPos = tr.doc.resolve(tr.mapping.map(pos))
      const $toPos = tr.doc.resolve(tr.mapping.map(pos + node.nodeSize - 1))
      const nodeRange = $fromPos.blockRange($toPos, (node) =>
        change.node.type.contentMatch.matchType(node.type)
      )
      if (!nodeRange) {
        return
      }

      const targetLiftDepth = liftTarget(nodeRange)
      if (targetLiftDepth || targetLiftDepth === 0) {
        tr.lift(nodeRange, targetLiftDepth)
        deleteMap.appendMap(tr.steps[tr.steps.length - 1].getMap())
      }
    })
  }
}
