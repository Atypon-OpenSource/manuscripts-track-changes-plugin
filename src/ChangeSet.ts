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
  MarkChange,
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
    this.changes.forEach((c) => {
      if (
        currentNodeChange &&
        (c.from >= currentNodeChange.to ||
          c.dataTracked.statusUpdateAt !== currentNodeChange.dataTracked.statusUpdateAt) //meaning here that all the changes that were rejected/accepted at a different time cannot be handled under a single rootnode
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

      if (this.joinRelatedStructuralChanges(rootNodes, change)) {
        return
      }

      rootNodes.push([change])
    })

    return rootNodes.filter(
      (changes) =>
        changes.filter(
          (c) =>
            c.dataTracked.operation !== CHANGE_OPERATION.reference &&
            !(c.dataTracked.moveNodeId && c.dataTracked.operation === CHANGE_OPERATION.delete)
        ).length
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

  areMatchingWrapOperations(c1: TrackedChange, c2: TrackedChange) {
    const op1 = c1.dataTracked.operation
    const op2 = c2.dataTracked.operation

    return (
      (op1 === 'wrap_with_node' && (op2 === 'insert' || op2 === 'set_attrs')) ||
      (op2 === 'wrap_with_node' && (op1 === 'insert' || op1 === 'set_attrs'))
    )
  }

  areMatchingMarkOperations(c1: TrackedChange, c2: TrackedChange) {
    if (ChangeSet.isMarkChange(c1) && ChangeSet.isMarkChange(c2)) {
      const op1 = c1.dataTracked.operation
      const op2 = c2.dataTracked.operation
      if (op1 == op2 && c1.mark.type === c2.mark.type) {
        return true
      }
    }
    return false
  }

  /**
   * Group adjacent inline changes that has the same change operation
   */
  canJoinAdjacentInlineChanges(change: TrackedChange, index: number) {
    const nextChange = this.changeTree.at(index + 1)
    if (!nextChange) {
      return false
    }

    return (
      ChangeSet.isInline(change) &&
      ChangeSet.isInline(nextChange) &&
      change.to === nextChange.from &&
      (change.dataTracked.operation === nextChange.dataTracked.operation ||
        this.areMatchingWrapOperations(change, nextChange) ||
        this.areMatchingMarkOperations(change, nextChange))
    )
  }

  joinRelatedStructuralChanges(rootNodes: RootChanges, change: TrackedChange) {
    if (change.dataTracked.operation !== CHANGE_OPERATION.structure) {
      return
    }

    const index = rootNodes.findIndex(
      (c) =>
        c[0].dataTracked.operation === CHANGE_OPERATION.structure &&
        c[0].dataTracked.moveNodeId === change.dataTracked.moveNodeId
    )
    if (index !== -1) {
      rootNodes[index] = [...rootNodes[index], change]
    } else {
      rootNodes.push([change])
    }
    return true
  }

  /**
   * Flattens a changeTree into a list of IDs
   * @param changes
   */
  static flattenTreeToIds(changes: TrackedChange[]): string[] {
    return changes.flatMap((c) => (this.isNodeChange(c) ? [c.id, ...c.children.map((c) => c.id)] : c.id))
  }

  /**
   * Determines whether a change should be deleted when applying it to the document.
   * @param change
   */
  static shouldDeleteChange(change: TrackedChange) {
    const { status, operation } = change.dataTracked
    const allowedRejectedForDeletion = [
      CHANGE_OPERATION.insert,
      CHANGE_OPERATION.node_split,
      CHANGE_OPERATION.wrap_with_node,
      CHANGE_OPERATION.move,
    ]
    return (
      (allowedRejectedForDeletion.includes(operation) && status === CHANGE_STATUS.rejected) ||
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

  static isInlineMarkChange(change: TrackedChange) {
    if (ChangeSet.isMarkChange(change)) {
      return change.nodeType.isInline || change.nodeType.isText
    }
    return false
  }

  static isInline(c: TrackedChange) {
    return (
      c.type === 'text-change' ||
      (c.type === 'node-change' && c.node.isInline) ||
      ChangeSet.isInlineMarkChange(c)
    )
  }

  static isTextChange(change: TrackedChange): change is TextChange {
    return change.type === 'text-change'
  }

  static isMarkChange(change: TrackedChange): change is MarkChange {
    return change.type === 'mark-change'
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

  /**
   * Checks if the given `TrackedAttrs` array contains a pending change of the specified operation type.
   */
  static isPendingChange(trackedAttrs: TrackedAttrs[] | undefined, operation: CHANGE_OPERATION) {
    return !!trackedAttrs?.some((t) => t.operation === operation)
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
}
