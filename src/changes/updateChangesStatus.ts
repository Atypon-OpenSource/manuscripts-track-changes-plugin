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

import { closeHistory } from 'prosemirror-history'
import { EditorState, Transaction } from 'prosemirror-state'

import { ChangeSet } from '../ChangeSet'
import { CHANGE_OPERATION, CHANGE_STATUS, TextChange, TrackedChange } from '../types/change'
import { applyAcceptedRejectedChanges } from './applyChanges'
import { updateChangeAttrs } from './updateChangeAttrs'

export function updateChangesStatus(
  createdTr: Transaction,
  changeSet: ChangeSet,
  ids: string[],
  status: CHANGE_STATUS,
  userID: string,
  oldState: EditorState
) {
  const change = changeSet.get(ids[0])
  if (change && status !== CHANGE_STATUS.pending) {
    const textChanges: TextChange[] = []
    const nonTextChanges: TrackedChange[] = []

    changeSet.changes.forEach((c) => {
      if (ids.includes(c.id)) {
        c.dataTracked.status = status
        if (ChangeSet.isTextChange(c)) {
          textChanges.push(c)
        } else {
          nonTextChanges.push(c)

          if (c.dataTracked.operation === CHANGE_OPERATION.node_split) {
            // fetching a related reference change to be applied as well
            const relatedRefChange = changeSet.changes.find(
              (c) => c.dataTracked.operation === 'reference' && c.dataTracked.referenceId === change.id
            )
            if (relatedRefChange) {
              nonTextChanges.push(relatedRefChange)
            }
          }
        }
      }
    })

    const mapping = applyAcceptedRejectedChanges(createdTr, oldState.schema, nonTextChanges, changeSet)
    applyAcceptedRejectedChanges(createdTr, oldState.schema, textChanges, changeSet, mapping)
  } else {
    const changeTime = new Date().getTime()
    ids.forEach((changeId: string) => {
      const change = changeSet?.get(changeId)
      if (change) {
        createdTr = updateChangeAttrs(
          createdTr,
          change,
          {
            ...change.dataTracked,
            status,
            statusUpdateAt: changeTime,
            reviewedByID: userID,
          },
          oldState.schema
        )
      }
    })
  }
  /*
        History sometimes groups some steps, reversal of which, results in dataTracked loss.
        This is also an action that we definitely need to be undoable separately
      */
  closeHistory(createdTr)
}
