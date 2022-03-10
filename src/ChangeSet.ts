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
import { logger } from './logger'
import {
  CHANGE_OPERATION,
  CHANGE_STATUS,
  NodeChange,
  PartialTrackedChange,
  TextChange,
  TrackedAttrs,
  TrackedChange,
} from './types/change'

export class ChangeSet {
  _changes: PartialTrackedChange[]
  empty!: ChangeSet

  constructor(changes: PartialTrackedChange[] = []) {
    this._changes = changes
  }

  get changes(): TrackedChange[] {
    return this._changes.filter((c) => ChangeSet.isValidTrackedAttrs(c.attrs)) as TrackedChange[]
  }

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
    return this._changes.length === 0
  }

  get hasInconsistentData() {
    return this.hasDuplicateIds || this.hasIncompleteAttrs
  }

  get hasDuplicateIds() {
    const iterated = new Set()
    return this._changes.some((c) => {
      if (iterated.has(c.id)) {
        return true
      }
      iterated.add(c.id)
    })
  }

  get hasIncompleteAttrs() {
    return this._changes.some((c) => !ChangeSet.isValidTrackedAttrs(c.attrs))
  }

  get(id: string) {
    return this._changes.find((c) => c.id === id)
  }

  getIn(ids: string[]) {
    return ids
      .map((id) => this._changes.find((c) => c.id === id))
      .filter((c) => c !== undefined) as TrackedChange[]
  }

  getNotIn(ids: string[]) {
    return this._changes.filter((c) => ids.includes(c.id))
  }

  flatten(changes: TrackedChange[]) {
    return changes.flatMap((c) =>
      c.type === 'text-change' ? c.id : [c.id, ...c.children.map((c) => c.id)]
    )
  }

  static empty() {
    return empty
  }

  static shouldNotDelete(change: TrackedChange) {
    const { status, operation } = change.attrs
    return (
      (operation === CHANGE_OPERATION.insert && status === CHANGE_STATUS.accepted) ||
      (operation === CHANGE_OPERATION.delete && status === CHANGE_STATUS.rejected)
    )
  }

  static shouldDeleteChange(change: TrackedChange) {
    const { status, operation } = change.attrs
    return (
      (operation === CHANGE_OPERATION.insert && status === CHANGE_STATUS.rejected) ||
      (operation === CHANGE_OPERATION.delete && status === CHANGE_STATUS.accepted)
    )
  }

  static isValidTrackedAttrs(attrs: Partial<TrackedAttrs> = {}): boolean {
    if ('attrs' in attrs) {
      logger(
        `%c WARNING passed "attrs" as property to isValidTrackedAttrs(attrs)`,
        'color: #f3f32c',
        attrs
      )
    }
    const keys = ['id', 'userID', 'userName', 'operation', 'status', 'time']
    const entries = Object.entries(attrs)
    return (
      entries.length === keys.length &&
      entries.every(([key, val]) => keys.includes(key) && val !== undefined) &&
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

const empty = new ChangeSet()
