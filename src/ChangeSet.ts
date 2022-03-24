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
import {
  CHANGE_OPERATION,
  CHANGE_STATUS,
  NodeChange,
  PartialTrackedChange,
  TextChange,
  TrackedAttrs,
  TrackedChange,
} from './types/change'
import { log } from './utils/logger'

/**
 * ChangeSet is a data structure to contain the tracked changes with some utility methods and computed
 * values to allow easier operability.
 */
export class ChangeSet {
  #changes: PartialTrackedChange[]

  constructor(changes: PartialTrackedChange[] = []) {
    this.#changes = changes
  }

  /**
   * List of all the valid TrackedChanges. This prevents for example changes with duplicate ids being shown
   * in the UI, causing errors.
   */
  get changes(): TrackedChange[] {
    const iteratedIds = new Set()
    return this.#changes.filter((c) => {
      const valid = !iteratedIds.has(c.attrs.id) && ChangeSet.isValidTrackedAttrs(c.attrs)
      iteratedIds.add(c.attrs.id)
      return valid
    }) as TrackedChange[]
  }

  get invalidChanges() {
    return this.#changes.filter((c) => !this.changes.find((cc) => c.id === cc.id))
  }

  /**
   * List of 1-level nested changes where the top-most node change contains all the changes within its start
   * and end position. This is useful for showing the changes as groups in the UI.
   */
  get changeTree() {
    const rootNodes: TrackedChange[] = []
    let currentNodeChange: NodeChange | undefined
    this.changes.forEach((c) => {
      if (currentNodeChange && c.from >= currentNodeChange.to) {
        rootNodes.push(currentNodeChange)
        currentNodeChange = undefined
      }
      if (c.type === 'node-change' && currentNodeChange && c.from < currentNodeChange.to) {
        currentNodeChange.children.push(c)
      } else if (c.type === 'node-change') {
        currentNodeChange = { ...c, children: [] }
      } else if (c.type === 'text-change' && currentNodeChange && c.from < currentNodeChange.to) {
        currentNodeChange.children.push(c)
      } else if (c.type === 'text-change') {
        rootNodes.push(c)
      }
    })
    if (currentNodeChange) {
      rootNodes.push(currentNodeChange)
    }
    return rootNodes
  }

  get pending() {
    return this.changeTree.filter((c) => c.attrs.status === CHANGE_STATUS.pending)
  }

  get accepted() {
    return this.changeTree.filter((c) => c.attrs.status === CHANGE_STATUS.accepted)
  }

  get rejected() {
    return this.changeTree.filter((c) => c.attrs.status === CHANGE_STATUS.rejected)
  }

  get textChanges() {
    return this.changes.filter((c) => c.type === 'text-change')
  }

  get nodeChanges() {
    return this.changes.filter((c) => c.type === 'node-change')
  }

  get isEmpty() {
    return this.#changes.length === 0
  }

  /**
   * Used to determine whether `fixInconsistentChanges` has to be executed to replace eg duplicate ids or
   * changes that are missing attributes.
   */
  get hasInconsistentData() {
    return this.hasDuplicateIds || this.hasIncompleteAttrs
  }

  get hasDuplicateIds() {
    const iterated = new Set()
    return this.#changes.some((c) => {
      if (iterated.has(c.id)) {
        return true
      }
      iterated.add(c.id)
    })
  }

  get hasIncompleteAttrs() {
    return this.#changes.some((c) => !ChangeSet.isValidTrackedAttrs(c.attrs))
  }

  get(id: string) {
    return this.#changes.find((c) => c.id === id)
  }

  getIn(ids: string[]) {
    return ids
      .map((id) => this.#changes.find((c) => c.id === id))
      .filter((c) => c !== undefined) as PartialTrackedChange[]
  }

  getNotIn(ids: string[]) {
    return this.#changes.filter((c) => ids.includes(c.id))
  }

  /**
   * Flattens a changeTree into a list of IDs
   * @param changes
   */
  static flattenTreeToIds(changes: TrackedChange[]): string[] {
    return changes.flatMap((c) =>
      c.type === 'text-change' ? c.id : [c.id, ...c.children.map((c) => c.id)]
    )
  }

  /**
   * Determines whether a change should not be deleted when applying it to the document.
   * @param change
   */
  static shouldNotDelete(change: TrackedChange) {
    const { status, operation } = change.attrs
    return (
      (operation === CHANGE_OPERATION.insert && status === CHANGE_STATUS.accepted) ||
      (operation === CHANGE_OPERATION.delete && status === CHANGE_STATUS.rejected)
    )
  }

  /**
   * Determines whether a change should be deleted when applying it to the document.
   * @param change
   */
  static shouldDeleteChange(change: TrackedChange) {
    const { status, operation } = change.attrs
    return (
      (operation === CHANGE_OPERATION.insert && status === CHANGE_STATUS.rejected) ||
      (operation === CHANGE_OPERATION.delete && status === CHANGE_STATUS.accepted)
    )
  }

  /**
   * Checks whether change attributes contain all TrackedAttrs keys with non-undefined values
   * @param attrs
   */
  static isValidTrackedAttrs(attrs: Partial<TrackedAttrs> = {}): boolean {
    if ('attrs' in attrs) {
      log.warn('passed "attrs" as property to isValidTrackedAttrs(attrs)', attrs)
    }
    const trackedKeys: (keyof TrackedAttrs)[] = ['id', 'userID', 'operation', 'status', 'createdAt']
    const entries = Object.entries(attrs)
    return (
      entries.length === trackedKeys.length &&
      entries.every(
        ([key, val]) => trackedKeys.includes(key as keyof TrackedAttrs) && val !== undefined
      ) &&
      (attrs.id || '').length > 0 // Changes created with undefined id have '' as placeholder
    )
  }

  static isTextChange(change: TrackedChange): change is TextChange {
    return change.type === 'text-change'
  }

  static isNodeChange(change: TrackedChange): change is NodeChange {
    return change.type === 'node-change'
  }
}
