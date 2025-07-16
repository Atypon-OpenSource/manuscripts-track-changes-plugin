/*!
 * © 2025 Atypon Systems LLC
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
import { Transaction } from 'prosemirror-state'

import { ChangeSet } from '../ChangeSet'
import { getBlockInlineTrackedData } from '../compute/nodeHelpers'
import { CHANGE_OPERATION, ReferenceAttrs } from '../types/change'

/**
 * move reference change to parent node the deleted node and use index of that node to the related change
 */
export const propagateReferenceChange = (from: number, tr: Transaction, changeSet: ChangeSet) => {
  const node = tr.docs.length && tr.docs[0].nodeAt(from)
  if (!node || node.type === node.type.schema.nodes.paragraph) {
    return
  }

  const dataTracked = getBlockInlineTrackedData(node)?.filter(
    (c) => c.operation === CHANGE_OPERATION.reference
  ) as ReferenceAttrs[]

  if (!(dataTracked && dataTracked.length)) {
    return
  }

  const $pos = tr.doc.resolve(from)
  const isRootNode = !!$pos.parent.type.spec.attrs?.dataTracked
  if (isRootNode) {
    tr.setNodeMarkup($pos.before(), undefined, {
      ...$pos.parent.attrs,
      dataTracked: [...($pos.parent.attrs.dataTracked || []), ...dataTracked],
    })
  }

  // update index to use index of the deleted node
  dataTracked.map(({ referenceId }) => {
    const structureChange = changeSet.changes.find((c) => referenceId === c.dataTracked.moveNodeId)
    if (structureChange && structureChange.type === 'node-change') {
      const dataTracked = (getBlockInlineTrackedData(structureChange.node) || [])
        .map((c) => (c.id === structureChange.id ? { ...c, index: $pos.index() } : c))
        .filter((c) => !(c.operation === CHANGE_OPERATION.structure && isRootNode))
      tr.setNodeMarkup(structureChange.from, undefined, { ...structureChange.node.attrs, dataTracked })
    }
  })
}
