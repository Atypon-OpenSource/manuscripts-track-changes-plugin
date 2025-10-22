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
import { Mark, MarkSpec, MarkType, Node as PMNode, Schema, SchemaSpec } from 'prosemirror-model'

import { log } from './utils/logger'
import { CHANGE_OPERATION, CHANGE_STATUS, TrackedAttrs } from './types/change'
import { uuidv4 } from './utils/uuidv4'
import { isValidTrackableMark } from './utils/tracking'

export type NewEmptyAttrs = Omit<TrackedAttrs, 'id' | 'operation'>
export type NewInsertAttrs = Omit<TrackedAttrs, 'id' | 'operation'> & {
  operation: CHANGE_OPERATION.insert | CHANGE_OPERATION.wrap_with_node | CHANGE_OPERATION.structure
}

export type NewDeleteAttrs = Omit<TrackedAttrs, 'id' | 'operation'> & {
  operation: CHANGE_OPERATION.delete
}
export type NewUpdateAttrs = Omit<TrackedAttrs, 'id' | 'operation'> & {
  operation: CHANGE_OPERATION.set_node_attributes
  oldAttrs: Record<string, any>
}
export type NewSplitNodeAttrs = Omit<TrackedAttrs, 'id' | 'operation'> & {
  operation: CHANGE_OPERATION.node_split
}
export type NewMoveAttrs = Omit<TrackedAttrs, 'id' | 'operation'> & {
  operation: CHANGE_OPERATION.move
  indentationType?: 'indent' | 'unindent'
}
export type NewReferenceAttrs = Omit<TrackedAttrs, 'id' | 'operation'> & {
  operation: CHANGE_OPERATION.reference
  referenceId: string
}
export type NewTrackedAttrs = NewInsertAttrs | NewDeleteAttrs | NewUpdateAttrs | NewMoveAttrs

export function createNewInsertAttrs(attrs: NewEmptyAttrs): NewInsertAttrs {
  return {
    ...attrs,
    operation: CHANGE_OPERATION.insert,
  }
}

export function createNewWrapAttrs(attrs: NewEmptyAttrs): NewInsertAttrs {
  return {
    ...attrs,
    operation: CHANGE_OPERATION.wrap_with_node,
  }
}

export function createNewSplitAttrs(attrs: NewEmptyAttrs): NewSplitNodeAttrs {
  return {
    ...attrs,
    operation: CHANGE_OPERATION.node_split,
  }
}

export function createNewReferenceAttrs(attrs: NewEmptyAttrs, id: string): NewReferenceAttrs {
  return {
    ...attrs,
    operation: CHANGE_OPERATION.reference,
    referenceId: id,
  }
}

export function createNewDeleteAttrs(attrs: NewEmptyAttrs): NewDeleteAttrs {
  return {
    ...attrs,
    operation: CHANGE_OPERATION.delete,
  }
}

export function createNewMoveAttrs(
  attrs: NewEmptyAttrs,
  indentationType?: 'indent' | 'unindent'
): NewMoveAttrs {
  return {
    ...attrs,
    operation: CHANGE_OPERATION.move,
    ...(indentationType && { indentationType }),
  }
}

export function createNewUpdateAttrs(attrs: NewEmptyAttrs, oldAttrs: Record<string, any>): NewUpdateAttrs {
  // Omit dataTracked
  const { dataTracked, ...restAttrs } = oldAttrs
  return {
    ...attrs,
    operation: CHANGE_OPERATION.set_node_attributes,
    oldAttrs: JSON.parse(JSON.stringify(restAttrs)),
  }
}

export function createNewStructureAttrs(attrs: NewEmptyAttrs): NewInsertAttrs {
  return {
    ...attrs,
    operation: CHANGE_OPERATION.structure,
  }
}

export function createNewPendingAttrs(time: number, authorID: string) {
  return {
    authorID,
    reviewedByID: null,
    createdAt: time,
    updatedAt: time,
    statusUpdateAt: 0, // has to be zero as first so changes are not differeniated at start
    status: CHANGE_STATUS.pending,
  }
}

export function addTrackIdIfDoesntExist(attrs: Partial<TrackedAttrs>) {
  if (!attrs.id) {
    return {
      id: uuidv4(),
      ...attrs,
    }
  }
  return attrs
}

export function getTextNodeTrackedMarkData(node: PMNode | null, schema: Schema) {
  if (!node || !node.isText) {
    return undefined
  }
  const marksTrackedData: (Omit<Partial<TrackedAttrs>, 'operation'> & {
    operation: CHANGE_OPERATION
  })[] = []
  node.marks.forEach((mark) => {
    if (mark.type === schema.marks.tracked_insert || mark.type === schema.marks.tracked_delete) {
      const operation =
        mark.type === schema.marks.tracked_insert ? CHANGE_OPERATION.insert : CHANGE_OPERATION.delete
      marksTrackedData.push({ ...mark.attrs.dataTracked, operation })
    }
  })
  if (marksTrackedData.length > 1) {
    log.warn('inline node with more than 1 of tracked marks', marksTrackedData)
  }
  return marksTrackedData[0] || undefined
}

export function getBlockInlineTrackedData(node: PMNode): Partial<TrackedAttrs>[] | undefined {
  const { dataTracked } = node.attrs
  if (dataTracked && !Array.isArray(dataTracked)) {
    return [dataTracked]
  }
  return dataTracked || []
}

export function getMarkTrackedData(node: PMNode | undefined | null) {
  const tracked = node?.marks.reduce((acc, current) => {
    if (isValidTrackableMark(current) && current.attrs.dataTracked) {
      acc.set(current, current.attrs.dataTracked)
    }
    return acc
  }, new Map<Mark, Array<Partial<TrackedAttrs>>>())

  return tracked || new Map<Mark, Array<Partial<TrackedAttrs>>>()
}

export function getNodeTrackedData(
  node: PMNode | undefined | null,
  schema: Schema
): Partial<TrackedAttrs>[] | undefined {
  let tracked
  if (node && !node.isText) {
    tracked = getBlockInlineTrackedData(node)
  } else if (node?.isText) {
    tracked = getTextNodeTrackedMarkData(node, schema)
  }
  if (tracked && !Array.isArray(tracked)) {
    tracked = [tracked]
  }
  return tracked
}

export function shouldMergeTrackedAttributes(left?: Partial<TrackedAttrs>, right?: Partial<TrackedAttrs>) {
  if (!left || !right) {
    log.warn('passed undefined dataTracked attributes to shouldMergeTrackedAttributes', {
      left,
      right,
    })
    return false
  }
  return (
    left.status === right.status && left.operation === right.operation && left.authorID === right.authorID
  )
}

export function getMergeableMarkTrackedAttrs(
  node: PMNode | null,
  attrs: Partial<TrackedAttrs>,
  schema: Schema
) {
  const nodeAttrs = getTextNodeTrackedMarkData(node, schema)
  return nodeAttrs && shouldMergeTrackedAttributes(nodeAttrs, attrs) ? nodeAttrs : null
}
