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
import { CHANGE_OPERATION, CHANGE_STATUS } from '../types/change'
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
  if (
    change &&
    ((status === CHANGE_STATUS.accepted && change.dataTracked.operation === CHANGE_OPERATION.delete) ||
      (status === CHANGE_STATUS.rejected && change.dataTracked.operation === CHANGE_OPERATION.insert))
  ) {
    const topChanges = [...ids]
    changeSet.changeTree.forEach((change) => {
      if (ids.includes(change.id)) {
        if (change.type === 'node-change') {
          change.children.forEach((childChange) => {
            const childIndex = topChanges.indexOf(childChange.id)
            if (childIndex >= 0) {
              topChanges.splice(childIndex)
            }
          })
        }
      }
    })
    topChanges.map((id) => {
      const change = changeSet.get(id)
      if (change) {
        createdTr.delete(createdTr.mapping.map(change.from), createdTr.mapping.map(change.to))
      }
    })
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
