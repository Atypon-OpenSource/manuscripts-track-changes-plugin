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
export enum CHANGE_OPERATION {
  insert = 'insert',
  delete = 'delete',
  set_node_attributes = 'set_attrs',
  node_split = 'node_split',
  split_source = 'split_source',
  wrap_with_node = 'wrap_with_node',
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

export type SplitSourceAttrs = Omit<InsertDeleteAttrs, 'operation'> & {
  operation: CHANGE_OPERATION.split_source
  referenceId: string
}

export type TrackedAttrs = InsertDeleteAttrs | UpdateAttrs | WrapAttrs | NodeSplitAttrs | SplitSourceAttrs

type Change = {
  id: string
  from: number
  to: number
  dataTracked: TrackedAttrs
}
export type TextChange = Change & {
  type: 'text-change'
  text: string
}
export type NodeChange = Change & {
  type: 'node-change'
  nodeType: string
  children: TrackedChange[]
}
export type NodeAttrChange = Change & {
  type: 'node-attr-change'
  nodeType: string
  oldAttrs: Record<string, any>
  newAttrs: Record<string, any>
}
export type WrapChange = Change & {
  type: 'wrap-change'
  wrapperNode: string
}
export type SplitSourceChange = Change & {
  type: 'split-source'
}
export type MarkChange = Change & {
  type: 'mark-change'
}
export type TrackedChange =
  | TextChange
  | NodeChange
  | NodeAttrChange
  | WrapChange
  | SplitSourceChange
  | MarkChange
export type PartialChange<T extends TrackedChange> = Omit<T, 'dataTracked'> & {
  dataTracked: Partial<TrackedAttrs>
}
export type IncompleteChange = Omit<TrackedChange, 'dataTracked'> & {
  dataTracked: Partial<TrackedAttrs>
}
export type ChangeType = TrackedChange['type']
