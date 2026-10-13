/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

/**
 * Type helpers over the generated OpenAPI types (`generated/engineApi.d.ts`, from `engine/openapi.json`):
 * given a path and an HTTP method they give the query, path parameters, JSON body and JSON response.
 */
import type { paths } from '../generated/engineApi';

export type { paths };
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Engine paths that declare the method `M`. */
export type EnginePath<M extends HttpMethod> = {
  [P in keyof paths]: paths[P][M] extends object ? P : never;
}[keyof paths];

type Operation<P extends keyof paths, M extends HttpMethod> = paths[P][M];

type ParametersOf<O> = O extends { parameters: infer Q } ? Q : never;
type Defined<T> = Exclude<T, undefined | never>;

export type QueryOf<O> = ParametersOf<O> extends { query?: infer Q } ? Defined<Q> : never;
export type PathParamsOf<O> = ParametersOf<O> extends { path?: infer Q } ? Defined<Q> : never;

type RequestBodyOf<O> = O extends { requestBody?: infer B } ? Defined<B> : never;
export type JsonBodyOf<O> = RequestBodyOf<O> extends { content: { 'application/json': infer J } } ? J : never;
export type FormBodyOf<O> = RequestBodyOf<O> extends { content: { 'multipart/form-data': infer J } } ? J : never;

type ResponsesOf<O> = O extends { responses: infer R } ? R : never;
type OkResponse<O> = ResponsesOf<O>[Extract<keyof ResponsesOf<O>, 200 | 201 | 202>];
export type JsonResponseOf<O> = OkResponse<O> extends { content: { 'application/json': infer J } } ? J : undefined;

export interface EngineRequestOptions<P extends keyof paths, M extends HttpMethod> {
  query?: QueryOf<Operation<P, M>>;
  params?: PathParamsOf<Operation<P, M>>;
  /** JSON body (typed by the schema). */
  body?: JsonBodyOf<Operation<P, M>>;
  /** Multipart body (uploads); the content type and boundary are set by `fetch`. */
  form?: FormData;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type EngineResponse<P extends keyof paths, M extends HttpMethod> = JsonResponseOf<Operation<P, M>>;
