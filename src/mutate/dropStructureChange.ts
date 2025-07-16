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
import { addTrackIdIfDoesntExist, getBlockInlineTrackedData } from '../compute/nodeHelpers'
import { CHANGE_OPERATION, CHANGE_STATUS, ReferenceAttrs } from '../types/change'
import * as trackUtils from '../utils/track-utils'

/**
 * if the node with reference change related to structure change get deleted will
 * drop structure change make it as insert change
 */
export const dropStructureChange = (from: number, tr: Transaction, changeSet: ChangeSet) => {
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

  dataTracked.map(({ referenceId }) => {
    const structureChange = changeSet.changes.find((c) => referenceId === c.dataTracked.moveNodeId)
    if (structureChange && structureChange.type === 'node-change') {
      const dataTracked = (getBlockInlineTrackedData(structureChange.node) || []).filter(
        (c) => c.operation === CHANGE_OPERATION.reference
      )
      const emptyAttrs = {
        authorID: structureChange.dataTracked.authorID,
        reviewedByID: null,
        createdAt: tr.time,
        updatedAt: tr.time,
        statusUpdateAt: 0,
        status: CHANGE_STATUS.pending,
      }
      const insertChange = addTrackIdIfDoesntExist(trackUtils.createNewInsertAttrs(emptyAttrs))

      tr.setNodeMarkup(structureChange.from, undefined, {
        ...structureChange.node.attrs,
        dataTracked: [insertChange, ...dataTracked],
      })
    }
  })
}
