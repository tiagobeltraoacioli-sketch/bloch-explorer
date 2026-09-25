export type Asset = 'BTC' | 'ETH' | 'USDT' | 'USDC' | 'BLCH';
export interface EvidenceNode { id: string; kind: 'address' | 'script_hash' | 'transaction'; address?: string; txid?: string }
export interface EvidenceRecord { event_id: string; from: string; to: string; kind: string; amount_base_units: string; txid: string; block_number: number; block_hash: string; block_time?: string; position?: number; outpoint?: {txid: string; vout: number} }
export interface EvidencePacket {
  kind: 'graphus_network_collection'; schema_version: 1; exported_at: string; dataset_sha256: string;
  aml_score_included: false; identity_attribution_included: false;
  dataset: { asset: Asset; network: string; source: string; retrieved_at: string; coverage: string;
    anchor: {height: number; hash: string; finality?: string}; nodes: EvidenceNode[]; edges: EvidenceRecord[];
    snapshots: {source: string; retrieved_at: string; anchor: {height: number; hash: string}; records: number; requested_cursor: string | null}[] };
  diagnostics: {references: number; records: number; transactions: number; blocks: number; source_pages: number; records_without_timestamp: number; record_types: Record<string, number>};
  pagination?: {next_cursor: string | null; requested_cursors: (string | null)[]};
  selection?: {parent_dataset_sha256: string; filters: RecordFilters};
}
export interface RecordFilters {query?: string; kind?: string; direction?: string; minBlock?: string; maxBlock?: string; minimum?: string; maximum?: string}
export interface Comparison {asset: Asset; baseline_sha256: string; current_sha256: string; counts: Record<'only_current' | 'only_baseline' | 'changed' | 'shared', number>; interpretation: string}
export const COLLECTION_LIMITS: {pages: number; nodes: number; records: number; bytes: number};
export function evidencePacket(raw: unknown, asset: Asset, options?: {cursor?: string | null}): Promise<EvidencePacket>;
export function fetchEvidence(asset: Asset, options?: {fetcher?: typeof fetch; signal?: AbortSignal; cursor?: string | null}): Promise<EvidencePacket>;
export function mergeEvidence(previous: EvidencePacket | null, page: EvidencePacket): Promise<EvidencePacket>;
export function selectRecords(packet: EvidencePacket, filters?: RecordFilters): {rows: EvidenceRecord[]; filters: RecordFilters};
export function filteredEvidence(packet: EvidencePacket, filters?: RecordFilters): Promise<EvidencePacket>;
export function compareEvidence(baseline: EvidencePacket, current: EvidencePacket): Comparison;
export function validateEvidenceCollection(packet: unknown): Promise<EvidencePacket>;
