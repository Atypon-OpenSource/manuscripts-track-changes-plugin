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
import { Fragment, Schema, Slice } from 'prosemirror-model'
import { Transaction } from 'prosemirror-state'

import { ChangeSet } from '../ChangeSet'
import { getBlockInlineTrackedData } from '../compute/nodeHelpers'
import { CHANGE_OPERATION, CHANGE_STATUS, IncompleteChange, NodeChange } from '../types/change'
import { getUpdatedDataTracked } from './applyChanges'

/**
 *  move split-ed content back to the original node. and will update original node dataTracked in these cases:
 *  * the split-ed node has another split will move split_source attr to the original node.
 *  * remove deleted track attr from original node
 */
function revertSplitNodeChange(tr: Transaction, change: IncompleteChange, changeSet: ChangeSet) {
  let sourceChange = changeSet.changes.find(
    (c) => c.dataTracked.operation === 'reference' && c.dataTracked.referenceId === change.id
  )!
  const node = tr.doc.nodeAt(change.from) as ManuscriptNode
  tr.replaceWith(change.from, change.to, Fragment.empty)
  tr.replaceWith(sourceChange.to - 1, sourceChange.to, node.content)

  if ((change as NodeChange).nodeType === 'list_item') {
    tr.join(sourceChange.to - 1)
  }

  // in case node split has another split will move source to the above node
  const childSource = changeSet.changes.find(
    (c) => c.from === change.from && c.dataTracked.operation === 'reference'
  )
  if (childSource) {
    const node = tr.doc.nodeAt(sourceChange.from) as ManuscriptNode
    const dataTracked = getBlockInlineTrackedData(node)!.map((c) =>
      c.operation === 'reference' ? childSource.dataTracked : c
    )
    tr.setNodeMarkup(sourceChange.from, undefined, { ...node.attrs, dataTracked }, node.marks)
  }

  // This will remove delete attr from source node, to avoid conflict with the moved content
  const deleteChange = changeSet.changes.find(
    (c) => c.dataTracked.operation == 'delete' && c.from === sourceChange.from
  )
  if (deleteChange) {
    const node = tr.doc.nodeAt(deleteChange.from) as ManuscriptNode
    tr.setNodeMarkup(
      deleteChange.from,
      undefined,
      getUpdatedDataTracked(node.attrs.dataTracked, deleteChange.id)
    )
  }
}

function revertWrapNodeChange(tr: Transaction, change: IncompleteChange) {
  let content = Fragment.from()
  const node = tr.doc.nodeAt(change.from)!
  node.content.forEach((node) => {
    content = content.append(node.content)
  })
  tr.replaceWith(change.from, change.to, Fragment.empty)
  tr.insert(tr.mapping.map(change.to), content)
}

export function revertRejectedChanges(
  tr: Transaction,
  schema: Schema,
  ids: string[],
  changeSet: ChangeSet,
  status: CHANGE_STATUS
) {
  if (status !== CHANGE_STATUS.rejected) {
    return
  }

  ids.forEach((id) => {
    const change = changeSet.get(id)!
    if (change.dataTracked.operation === CHANGE_OPERATION.node_split) {
      revertSplitNodeChange(tr, change, changeSet)
    }
    if (change.dataTracked.operation === CHANGE_OPERATION.wrap_with_node) {
      revertWrapNodeChange(tr, change)
    }
  })
}
