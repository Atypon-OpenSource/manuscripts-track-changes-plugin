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
import {
  CHANGE_OPERATION,
  CHANGE_STATUS,
  IncompleteChange,
  MoveChange,
  NodeAttrChange,
  NodeChange,
  ReferenceChange,
  RootChange,
  RootChanges,
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
  #changes: (TrackedChange | IncompleteChange)[]

  constructor(changes: (TrackedChange | IncompleteChange)[] = []) {
    this.#changes = changes
  }

  /**
   * List of all the valid TrackedChanges. This prevents for example changes with duplicate ids being shown
   * in the UI, causing errors.
   */
  get changes(): TrackedChange[] {
    const iteratedIds = new Set()
    return this.#changes.filter((c) => {
      const valid = !iteratedIds.has(c.dataTracked.id) && ChangeSet.isValidDataTracked(c.dataTracked)
      iteratedIds.add(c.dataTracked.id)
      return valid
    }) as TrackedChange[]
  }

  get invalidChanges() {
    const invalid = this.#changes.filter((c) => {
      return !this.changes.includes(c as TrackedChange)
    })
    return invalid
  }

  /**
   * List of 1-level nested changes where the top-most node change contains all the changes within its start
   * and end position. This is useful for showing the changes as groups in the UI.
   */
  get changeTree() {
    const rootNodes: TrackedChange[] = []
    let currentNodeChange: NodeChange | undefined

    const movePairs = this.#findMovePairs()
    const moveChangeIds = new Set<string>()
    const moveRanges: Array<{ insertFrom: number; insertTo: number; deleteFrom: number; deleteTo: number }> =
      []

    // Collect IDs and ranges of move operations
    movePairs.forEach((pair) => {
      moveChangeIds.add(pair.insert.id)
      if (pair.delete) {
        moveChangeIds.add(pair.delete.id)
      }
      moveRanges.push({
        insertFrom: pair.insert.from,
        insertTo: pair.insert.to,
        deleteFrom: pair.delete?.from || pair.insert.from,
        deleteTo: pair.delete?.to || pair.insert.to,
      })
    })

    // Identify text changes that overlap with move ranges and skip them
    this.changes.forEach((c) => {
      if (c.type === 'text-change') {
        const textChange = c as TextChange
        const isRelatedToMove = moveRanges.some(
          (range) =>
            // Check if the text change overlaps with the insert range
            (textChange.from >= range.insertFrom &&
              textChange.to <= range.insertTo &&
              textChange.dataTracked.operation === CHANGE_OPERATION.insert) ||
            // Check if the text change overlaps with the delete range
            (textChange.from >= range.deleteFrom &&
              textChange.to <= range.deleteTo &&
              textChange.dataTracked.operation === CHANGE_OPERATION.delete)
        )
        if (isRelatedToMove) {
          moveChangeIds.add(c.id)
        }
      }
    })

    // Process move pairs first to create unified move changes
    movePairs.forEach(({ insert, delete: deleteChange }) => {
      const moveChange = this.#createMoveChange(insert, deleteChange)
      rootNodes.push(moveChange)
    })

    this.changes.forEach((c) => {
      if (moveChangeIds.has(c.id)) {
        return // Skip original insert/delete and related text changes
      }

      if (
        currentNodeChange &&
        (c.from >= currentNodeChange.to ||
          c.dataTracked.statusUpdateAt !== currentNodeChange.dataTracked.statusUpdateAt)
      ) {
        rootNodes.push(currentNodeChange)
        currentNodeChange = undefined
      }
      if (
        currentNodeChange &&
        c.from < currentNodeChange.to &&
        !(this.#isSameNodeChange(currentNodeChange, c) && this.#isNotPendingOrDeleted(currentNodeChange))
      ) {
        currentNodeChange.children.push(c)
      } else if (c.type === 'node-change') {
        // check if this change belongs to a previously pushed root
        const result = this.matchAndAddToRootChange(rootNodes, c)
        if (result) {
          const { index, root } = result
          rootNodes[index] = root
        } else {
          currentNodeChange = { ...c, children: [] }
        }
      } else {
        // check if this change belongs to a previously pushed root
        const result = this.matchAndAddToRootChange(rootNodes, c)
        if (result) {
          const { index, root } = result
          rootNodes[index] = root
        } else {
          rootNodes.push(c)
        }
      }
    })
    if (currentNodeChange) {
      rootNodes.push(currentNodeChange)
    }

    return rootNodes
  }

  /**
   * Group adjacent inline changes and composite block changes
   */
  get groupChanges() {
    const rootNodes: RootChanges = []
    let currentInlineChange: RootChange | undefined

    this.changeTree.map((change, index) => {
      if (this.canJoinAdjacentInlineChanges(change, index)) {
        currentInlineChange = currentInlineChange ? [...currentInlineChange, change] : [change]
        return
      } else if (currentInlineChange) {
        rootNodes.push([...currentInlineChange, change])
        currentInlineChange = undefined
        return
      }
      // TODO:: group composite block changes
      rootNodes.push([change])
    })

    return rootNodes.filter(
      (changes) => changes.filter((c) => c.dataTracked.operation !== CHANGE_OPERATION.reference).length
    )
  }

  get pending() {
    return this.changes.filter((c) => c.dataTracked.status === CHANGE_STATUS.pending)
  }

  get textChanges() {
    return this.changes.filter((c) => c.type === 'text-change')
  }

  get nodeChanges() {
    return this.changes.filter((c) => c.type === 'node-change')
  }

  get nodeAttrChanges() {
    return this.changes.filter((c) => c.type === 'node-attr-change')
  }

  get bothNodeChanges() {
    return this.changes.filter(
      (c) => c.type === 'node-change' || c.type === 'reference-change' || c.type === 'node-attr-change'
    )
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
    return this.#changes.some((c) => !ChangeSet.isValidDataTracked(c.dataTracked))
  }

  get(id: string) {
    return this.#changes.find((c) => c.id === id)
  }

  getIn(ids: string[]) {
    return ids.map((id) => this.#changes.find((c) => c.id === id)).filter((c) => c !== undefined) as (
      | TrackedChange
      | IncompleteChange
    )[]
  }

  getNotIn(ids: string[]) {
    return this.#changes.filter((c) => ids.includes(c.id))
  }

  // Searches for a root change for the given change in the rootNodes and updates the root by pushing the new change if it belongs to it.
  matchAndAddToRootChange(rootNodes: TrackedChange[], change: TrackedChange) {
    for (let i = 0; i < rootNodes.length; i++) {
      const root = rootNodes[i] as NodeChange
      if (
        root.type === 'node-change' &&
        change.from < root.to &&
        change.dataTracked.statusUpdateAt === root.dataTracked.statusUpdateAt
      ) {
        root.children.push(change)
        return { index: i, root }
      }
    }
  }

  /**
   * Group adjacent inline changes that has the same change operation
   */
  canJoinAdjacentInlineChanges(change: TrackedChange, index: number) {
    const nextChange = this.changeTree.at(index + 1)
    const isInline = (c: TrackedChange) =>
      c.type === 'text-change' || (c.type === 'node-change' && c.node.isInline)
    return (
      isInline(change) &&
      nextChange &&
      isInline(nextChange) &&
      change.to === nextChange.from &&
      change.dataTracked.operation === nextChange.dataTracked.operation
    )
  }

  /**
   * Flattens a changeTree into a list of IDs
   * @param changes
   */
  static flattenTreeToIds(changes: TrackedChange[]): string[] {
    return changes.flatMap((c) =>
      this.isNodeChange(c) || this.isMoveChange(c) ? [c.id, ...c.children.map((c) => c.id)] : c.id
    )
  }

  /**
   * Determines whether a change should be deleted when applying it to the document.
   * @param change
   */
  static shouldDeleteChange(change: TrackedChange) {
    const { status, operation } = change.dataTracked
    return (
      ((operation === CHANGE_OPERATION.insert ||
        operation === CHANGE_OPERATION.node_split ||
        operation === CHANGE_OPERATION.move ||
        operation === CHANGE_OPERATION.wrap_with_node) &&
        status === CHANGE_STATUS.rejected) ||
      (operation === CHANGE_OPERATION.delete && status === CHANGE_STATUS.accepted)
    )
  }

  /**
   * Checks whether change attributes contain all TrackedAttrs keys with non-undefined values
   * @param dataTracked
   */
  static isValidDataTracked(dataTracked: Partial<TrackedAttrs> = {}): boolean {
    if ('dataTracked' in dataTracked) {
      log.warn('passed "dataTracked" as property to isValidTrackedAttrs()', dataTracked)
    }
    const trackedKeys: (keyof TrackedAttrs)[] = [
      'id',
      'authorID',
      'operation',
      'status',
      'createdAt',
      'updatedAt',
    ]
    // reviewedByID is set optional since either ProseMirror or Yjs doesn't like persisting null values inside attributes objects
    // So it can be either omitted completely or at least be null or string
    const optionalKeys: (keyof TrackedAttrs)[] = ['reviewedByID']
    const entries = Object.entries(dataTracked).filter(([key, val]) =>
      trackedKeys.includes(key as keyof TrackedAttrs)
    )
    const optionalEntries = Object.entries(dataTracked).filter(([key, val]) =>
      optionalKeys.includes(key as keyof TrackedAttrs)
    )
    return (
      entries.length === trackedKeys.length &&
      entries.every(([key, val]) => trackedKeys.includes(key as keyof TrackedAttrs) && val !== undefined) &&
      optionalEntries.every(
        ([key, val]) => optionalKeys.includes(key as keyof TrackedAttrs) && val !== undefined
      ) &&
      (dataTracked.id || '').length > 0 // Changes created with undefined id have '' as placeholder
    )
  }

  static isTextChange(change: TrackedChange): change is TextChange {
    return change.type === 'text-change'
  }

  static isNodeChange(change: TrackedChange): change is NodeChange {
    return change.type === 'node-change'
  }

  static isNodeAttrChange(change: TrackedChange): change is NodeAttrChange {
    return change.type === 'node-attr-change'
  }

  static isReferenceChange(change: TrackedChange): change is ReferenceChange {
    return change.type === 'reference-change'
  }

  static isMoveChange(change: TrackedChange): change is MoveChange {
    return change.type === 'move-change'
  }

  #isSameNodeChange(currentChange: NodeChange, nextChange: TrackedChange) {
    return currentChange.from === nextChange.from && currentChange.to === nextChange.to
  }

  #isNotPendingOrDeleted(change: TrackedChange) {
    return (
      change.dataTracked.operation !== CHANGE_OPERATION.delete &&
      change.dataTracked.status !== CHANGE_STATUS.pending
    )
  }

  #createMoveChange(insert: TrackedChange, deleteChange?: TrackedChange): MoveChange {
    const insertNodeChange = insert as NodeChange

    if (!insertNodeChange.node) {
      throw new Error('Cannot create MoveChange: insert node is undefined')
    }

    const moveChange: MoveChange = {
      type: 'move-change',
      id: `move-${insert.id}-${deleteChange?.id || ''}`,
      from: insert.from,
      to: insert.to,
      originalFrom: deleteChange?.from || insert.from, // Original position
      originalTo: deleteChange?.to || insert.to,
      node: insertNodeChange.node,
      dataTracked: {
        ...insert.dataTracked,
        operation: CHANGE_OPERATION.move,
        isNodeMove: true,
      },
      children: [],
    }
    return moveChange
  }

  #findMovePairs(): Array<{ insert: TrackedChange; delete?: TrackedChange }> {
    const matchedDeleteIds = new Set<string>()

    const pairs = this.changes
      .filter(
        (c) =>
          c.type === 'node-change' && // Only include NodeChange entries
          c.dataTracked.operation === CHANGE_OPERATION.insert &&
          c.dataTracked.isNodeMove
      )
      .map((insert) => {
        const matchingDelete = this.changes.find(
          (d) =>
            d.type === 'node-change' &&
            d.dataTracked.operation === CHANGE_OPERATION.delete &&
            d.dataTracked.isNodeMove &&
            d.dataTracked.createdAt === insert.dataTracked.createdAt &&
            d.dataTracked.authorID === insert.dataTracked.authorID &&
            !matchedDeleteIds.has(d.id)
        )

        if (matchingDelete) {
          matchedDeleteIds.add(matchingDelete.id)
        }

        return {
          insert,
          delete: matchingDelete,
        }
      })
      .filter((pair) => pair.delete) // Only include pairs with a matching delete

    return pairs
  }
}
