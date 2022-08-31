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
import { Node as PMNode, Schema, Slice } from 'prosemirror-model'
import type { Transaction } from 'prosemirror-state'

import { log } from '../utils/logger'
import { ExposedFragment, ExposedSlice } from '../types/pm'
import { ChangeStep, DeleteNodeStep, DeleteTextStep, InsertSliceStep } from '../types/step'

export function matchInserted(
  inDeleted: number,
  deleted: ChangeStep[],
  inserted: ExposedFragment,
  newTr: Transaction,
  schema: Schema
): [number, ChangeStep[]] {
  for (let i = 0; ; i += 1) {
    if (inserted.childCount === i) return [inDeleted, deleted]
    const child = inserted.child(i)
    // @ts-ignore
    let adjDeleted: DeleteTextStep | DeleteNodeStep | undefined = deleted.find(
      (d) =>
        (d.type === 'delete-text' && d.to === inDeleted) ||
        (d.type === 'delete-node' && d.nodeEnd === inDeleted)
    )
    if (child.type !== adjDeleted?.node?.type) {
      return [inDeleted, deleted]
    } else if (child.isText && adjDeleted?.node) {
      adjDeleted = adjDeleted as DeleteTextStep
      const { pos, from, to, node } = adjDeleted
      let j = 0,
        d = from - pos,
        maxSteps = Math.max(pos, from) - to
      // Match text inside the inserted text node to the deleted text node
      for (
        ;
        maxSteps !== j && child.text![j] !== undefined && child.text![j] === node.text![d];
        j += 1, d += 1
      ) {
        inDeleted -= 1
      }
      // this is needed incase diffing tr.doc
      // deleted.push({
      //   pos: pos,
      //   type: 'update-node-attrs',
      //   // Should check the attrs for equality in fixInconsistentChanges? to remove dataTracked completely
      //   oldAttrs: adjDeleted.node.attrs || {},
      //   newAttrs: child.attrs || {},
      // })
      if (maxSteps !== j) {
        deleted.push({
          pos,
          from: Math.max(pos, from) + j,
          to,
          type: 'delete-text',
          node,
        })
      }
      return [inDeleted, deleted.filter((d) => d !== adjDeleted)]
    } else if (child.content.size > 0 || adjDeleted?.node.content.size > 0) {
      // Move the inDeleted inside the block node's boundary
      return matchInserted(
        inDeleted - 1,
        deleted.filter((d) => d !== adjDeleted),
        child.content as ExposedFragment,
        newTr,
        schema
      )
    }
    deleted.push({
      pos: adjDeleted.pos,
      type: 'update-node-attrs',
      node: adjDeleted.node,
      // Should check the attrs for equality in fixInconsistentChanges? to remove dataTracked completely
      newAttrs: child.attrs || {},
    })
    deleted = deleted.filter((d) => d !== adjDeleted)
    inDeleted -= child.nodeSize
  }
}

export function diffChangeSteps(
  deleted: ChangeStep[],
  inserted: InsertSliceStep[],
  newTr: Transaction,
  schema: Schema
) {
  const updated: ChangeStep[] = []
  let updatedDeleted = [...deleted]
  inserted.forEach((ins) => {
    const [inDeleted, updatedDel] = matchInserted(
      ins.from,
      updatedDeleted,
      ins.slice.content,
      newTr,
      schema
    )
    if (inDeleted === ins.from) {
      updated.push(ins)
      return
    }
    updatedDeleted = updatedDel
    const newInsertedA = ins.slice.content.cut(ins.from - inDeleted)
    const newInsertedB = ins.slice.content.cut(ins.from - inDeleted + 1)
    // Super hax to cut over block node boundaries in the inserted fragment
    const newInserted = newInsertedA.size === newInsertedB.size + 2 ? newInsertedB : newInsertedA
    if (newInserted.size > 0) {
      updated.push({
        ...ins,
        slice: new Slice(newInserted, ins.slice.openStart, ins.slice.openEnd) as ExposedSlice,
      })
    }
  })
  return [...updatedDeleted, ...updated]
}
