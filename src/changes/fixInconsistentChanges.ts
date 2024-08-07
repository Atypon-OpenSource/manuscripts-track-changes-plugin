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
import { Schema } from 'prosemirror-model'
import { Transaction } from 'prosemirror-state'

import { ChangeSet } from '../ChangeSet'
import { CHANGE_OPERATION, CHANGE_STATUS } from '../types/change'
import { uuidv4 } from '../utils/uuidv4'
import { updateChangeAttrs } from './updateChangeAttrs'

/**
 * Iterates over a ChangeSet to check all changes have their required attributes
 *
 * This inconsistency might happen due to a bug in the track changes implementation or by a user somehow applying an empty insert/delete mark that doesn't contain proper data. Also this checks the track IDs for duplicates.
 * @param changeSet
 * @param currentUser
 * @param newTr
 * @param schema
 * @return docWasChanged, a boolean
 */
export function fixInconsistentChanges(
  changeSet: ChangeSet,
  currentUserID: string,
  newTr: Transaction,
  schema: Schema
) {
  const iteratedIds = new Set()
  const validIds = new Set(changeSet.changes.map((c) => c.id))
  let changed = false
  changeSet.invalidChanges.forEach((c) => {
    const { id, authorID, operation, reviewedByID, status, createdAt, statusUpdateAt, updatedAt } =
      c.dataTracked
    const newAttrs = {
      ...((!id || iteratedIds.has(id) || validIds.has(id) || id.length === 0) && { id: uuidv4() }),
      ...(!authorID && { authorID: currentUserID }),
      // Dont add a default operation -> rather have updateChangeAttrs delete the track data
      // ...(!operation && { operation: CHANGE_OPERATION.insert }),
      ...(!reviewedByID && { reviewedByID: null }),
      ...(!status && { status: CHANGE_STATUS.pending }),
      ...(!createdAt && { createdAt: Date.now() }),
      ...(!updatedAt && { updatedAt: Date.now() }),
      ...(!statusUpdateAt && { statusUpdateAt: 0 }),
    }
    if (Object.keys(newAttrs).length > 0) {
      updateChangeAttrs(newTr, c, { ...c.dataTracked, ...newAttrs }, schema)
      changed = true
    }
    iteratedIds.add(newAttrs.id || id)
  })
  return changed
}
