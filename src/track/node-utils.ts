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
import { Mark, Node as PMNode, Schema } from 'prosemirror-model'
import { Transaction } from 'prosemirror-state'
import { canJoin, liftTarget, Mapping } from 'prosemirror-transform'

import { ChangeSet } from '../ChangeSet'
import { CHANGE_OPERATION, TrackedAttrs, TrackedChange } from '../types/change'
import { log } from '../utils/logger'
import { uuidv4 } from '../utils/uuidv4'

export function addTrackIdIfDoesntExist(attrs: Partial<TrackedAttrs>) {
  if (!attrs.id) {
    return {
      id: uuidv4(),
      ...attrs,
    }
  }
  return attrs
}

/**
 * Not in use, maybe for ReplaceAroundSteps but we'll see
 * @param pos
 * @param tr
 */
export function liftNode(pos: number, tr: Transaction) {
  const startPos = tr.doc.resolve(pos)
  const node = tr.doc.nodeAt(pos)
  if (!node) {
    return undefined
  }
  const range = startPos.blockRange(tr.doc.resolve(startPos.pos + node.nodeSize))
  const targetDepth = range ? Number(liftTarget(range)) : NaN
  if (range && !Number.isNaN(targetDepth)) {
    return tr.lift(range, targetDepth)
  }
  return undefined
}

export function getInlineNodeTrackedMarkData(node: PMNode | undefined | null, schema: Schema) {
  if (!node || !node.isInline) {
    return undefined
  }
  const marksTrackedData: Omit<Partial<TrackedAttrs>, 'operation'> &
    { operation: CHANGE_OPERATION }[] = []
  node.marks.forEach((mark) => {
    if (mark.type === schema.marks.tracked_insert || mark.type === schema.marks.tracked_delete) {
      const operation =
        mark.type === schema.marks.tracked_insert
          ? CHANGE_OPERATION.insert
          : CHANGE_OPERATION.delete
      marksTrackedData.push({ ...mark.attrs.dataTracked, operation })
    }
  })
  if (marksTrackedData.length > 1) {
    log.warn('inline node with more than 1 of tracked marks', marksTrackedData)
  }
  return marksTrackedData[0] || undefined
}

export function getNodeTrackedData(
  node: PMNode | undefined | null,
  schema: Schema
): Partial<TrackedAttrs> | undefined {
  return !node
    ? undefined
    : node.isText
    ? getInlineNodeTrackedMarkData(node, schema)
    : node.attrs.dataTracked
}

export function equalMarks(n1: PMNode, n2: PMNode) {
  return (
    n1.marks.length === n2.marks.length &&
    n1.marks.every((mark) => n1.marks.find((m) => m.type === mark.type))
  )
}

export function shouldMergeTrackedAttributes(
  left?: Partial<TrackedAttrs>,
  right?: Partial<TrackedAttrs>
) {
  if (!left || !right) {
    log.warn('passed undefined dataTracked attributes to shouldMergeTrackedAttributes', {
      left,
      right,
    })
    return false
  }
  return (
    left.status === right.status &&
    left.operation === right.operation &&
    left.userID === right.userID
  )
}

export function getMergeableMarkTrackedAttrs(
  node: PMNode | undefined | null,
  attrs: Partial<TrackedAttrs>,
  schema: Schema
) {
  const nodeAttrs = getInlineNodeTrackedMarkData(node, schema)
  return nodeAttrs && shouldMergeTrackedAttributes(nodeAttrs, attrs) ? nodeAttrs : null
}
