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
import { Node as PMNode, Schema } from 'prosemirror-model'
import { Selection, Transaction } from 'prosemirror-state'
import { findTable } from 'prosemirror-utils'

import { getUpdatedDataTracked } from '../changes/applyChanges'
import { CHANGE_OPERATION, TrackedAttrs } from '../types/change'
import { NewEmptyAttrs } from '../types/track'
import { log } from '../utils/logger'
import { createNewDeleteAttrs, createNewInsertAttrs } from '../utils/track-utils'
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

export function getTextNodeTrackedMarkData(node: PMNode | undefined | null, schema: Schema) {
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
  return dataTracked
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

export function equalMarks(n1: PMNode, n2: PMNode) {
  return (
    n1.marks.length === n2.marks.length &&
    n1.marks.every((mark) => n1.marks.find((m) => m.type === mark.type))
  )
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
  node: PMNode | undefined | null,
  attrs: Partial<TrackedAttrs>,
  schema: Schema
) {
  const nodeAttrs = getTextNodeTrackedMarkData(node, schema)
  return nodeAttrs && shouldMergeTrackedAttributes(nodeAttrs, attrs) ? nodeAttrs : null
}

export function getCellChanged(node: PMNode): TrackedAttrs | undefined {
  return node.attrs.dataTracked?.find((attr: TrackedAttrs) => attr.referenceChangeId)
}

export function addTableColumnChange(
  tr: Transaction,
  newTr: Transaction,
  selection: Selection,
  emptyAttrs: NewEmptyAttrs
) {
  const tableColumnChange = tr.getMeta('tableColumnChange')
  if (tableColumnChange) {
    const table = findTable(tr.selection)
    const newAttr = addTrackIdIfDoesntExist(
      tableColumnChange === 'delete' ? createNewDeleteAttrs(emptyAttrs) : createNewInsertAttrs(emptyAttrs)
    )
    newAttr.referenceChangeId = newAttr.id
    emptyAttrs['referenceChangeId'] = newAttr.id

    if (table) {
      let dataTracked
      const cellChanged = getCellChanged(selection.$from.node())
      // if the user remove inserted column will remove change
      if (
        cellChanged?.referenceChangeId &&
        cellChanged.operation === CHANGE_OPERATION.insert &&
        tableColumnChange === 'delete'
      ) {
        dataTracked = getUpdatedDataTracked(table.node.attrs.dataTracked, cellChanged.referenceChangeId)
      } else {
        const tableChanges = getBlockInlineTrackedData(table.node) || []
        const updateChanges =
          cellChanged && tableColumnChange === 'delete'
            ? tableChanges.filter((c) => c.id !== cellChanged.referenceChangeId)
            : tableChanges
        dataTracked = [...updateChanges, newAttr]
      }

      newTr.setNodeMarkup(
        table.pos,
        undefined,
        {
          ...table.node.attrs,
          dataTracked,
        },
        table.node.marks
      )
    }
  }
}
