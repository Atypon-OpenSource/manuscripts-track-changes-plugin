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
export enum CHANGE_OPERATION {
  insert = 'insert',
  delete = 'delete',
  set_node_attributes = 'set_node_attributes',
  wrap_with_node = 'wrap_with_node',
  unwrap_from_node = 'unwrap_from_node',
  add_mark = 'add_mark',
  remove_mark = 'remove_mark',
}
export enum CHANGE_STATUS {
  accepted = 'accepted',
  rejected = 'rejected',
  pending = 'pending',
}
export interface TrackedAttrs {
  id: string
  authorID: string
  reviewedByID: string | null
  operation: CHANGE_OPERATION
  status: CHANGE_STATUS
  createdAt: number
  updatedAt: number
}
export type Change = {
  id: string
  from: number
  to: number
  attrs: TrackedAttrs
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
export type WrapChange = Change & {
  type: 'wrap-change'
  wrapperNode: string
}
export type MarkChange = Change & {
  type: 'mark-change'
}
export type TrackedChange = TextChange | NodeChange | WrapChange | MarkChange
export type PartialChange<T extends TrackedChange> = Omit<T, 'attrs'> & {
  attrs: Partial<TrackedAttrs>
}
export type IncompleteChange = Omit<TrackedChange, 'attrs'> & {
  attrs: Partial<TrackedAttrs>
}
export type ChangeType = TrackedChange['type']
