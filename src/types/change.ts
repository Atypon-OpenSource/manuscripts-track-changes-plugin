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

import { Node, NodeType } from 'prosemirror-model'

export enum CHANGE_OPERATION {
  insert = 'insert',
  delete = 'delete',
  set_node_attributes = 'set_attrs',
  wrap_with_node = 'wrap_with_node',
  node_split = 'node_split',
  reference = 'reference',
  move = 'move',
  structure = 'structure',
  // unwrap_from_node = 'unwrap_from_node',
  // add_mark = 'add_mark',
  // remove_mark = 'remove_mark',
}
export enum CHANGE_STATUS {
  accepted = 'accepted',
  rejected = 'rejected',
  pending = 'pending',
}
type InsertDeleteAttrs = {
  id: string
  authorID: string
  reviewedByID: string | null
  operation: CHANGE_OPERATION.insert | CHANGE_OPERATION.delete
  status: CHANGE_STATUS
  statusUpdateAt: number
  createdAt: number
  updatedAt: number
  moveNodeId?: string
}
export type UpdateAttrs = Omit<InsertDeleteAttrs, 'operation'> & {
  operation: CHANGE_OPERATION.set_node_attributes
  oldAttrs: Record<string, any>
}

export type WrapAttrs = Omit<InsertDeleteAttrs, 'operation'> & {
  operation: CHANGE_OPERATION.wrap_with_node
}

export type NodeSplitAttrs = Omit<InsertDeleteAttrs, 'operation'> & {
  operation: CHANGE_OPERATION.node_split
}

export type ReferenceAttrs = Omit<InsertDeleteAttrs, 'operation'> & {
  operation: CHANGE_OPERATION.reference
  referenceId: string
  isStructureRef?: boolean
}

export type NodeMoveAttrs = Omit<InsertDeleteAttrs, 'operation'> & {
  operation: CHANGE_OPERATION.move
}

export type StructureAttrs = Omit<InsertDeleteAttrs, 'operation'> & {
  operation: CHANGE_OPERATION.structure
  action: 'convert-to-paragraph' | 'convert-to-section'
  sectionLevel?: number
  isThereSectionBefore?: boolean
  isSupSection?: boolean
}

export type TrackedAttrs =
  | InsertDeleteAttrs
  | UpdateAttrs
  | WrapAttrs
  | NodeSplitAttrs
  | ReferenceAttrs
  | NodeMoveAttrs
  | StructureAttrs

type Change = {
  id: string
  from: number
  to: number
  dataTracked: TrackedAttrs
}
export type TextChange = Change & {
  type: 'text-change'
  text: string
  nodeType: NodeType
}
export type NodeChange = Change & {
  type: 'node-change'
  node: Node
  attrs: Record<string, any>
  children: TrackedChange[]
}
export type NodeAttrChange = Change & {
  type: 'node-attr-change'
  node: Node
  oldAttrs: Record<string, any>
  newAttrs: Record<string, any>
}
export type WrapChange = Change & {
  type: 'wrap-change'
  wrapperNode: string
}
export type ReferenceChange = Change & {
  type: 'reference-change'
}
export type MarkChange = Change & {
  type: 'mark-change'
}

export type TrackedChange =
  | TextChange
  | NodeChange
  | NodeAttrChange
  | WrapChange
  | ReferenceChange
  | MarkChange
export type PartialChange<T extends TrackedChange> = Omit<T, 'dataTracked'> & {
  dataTracked: Partial<TrackedAttrs>
}
export type IncompleteChange = Omit<TrackedChange, 'dataTracked'> & {
  dataTracked: Partial<TrackedAttrs>
}
export type RootChanges = TrackedChange[][]
export type RootChange = TrackedChange[]
