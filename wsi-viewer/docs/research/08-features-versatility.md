# 08 — Feature space, standards and extensibility

Research dimension for the Stoipath WSI viewer plan. Date: 2026-10-24. Audience: engineers / technical PO.

Verification note: the shared web-search budget for this run was exhausted before this dimension started, so facts below were verified by fetching primary sources directly (spec text and library source/README/package.json from GitHub, MDN browser-compat-data JSON, WCAG 2.2 understanding documents). Several spec hosts (nema.org, iiif.io, w3.org, readthedocs, rfc-editor) are blocked from this sandbox; where a fact comes from memory of those documents it is tagged **[not re-fetched]**, and anything inferred or estimated is tagged **[unverified]** or **[estimate]**. Library versions are what the default branch declared on 2026-10-24.

---

## Summary

1. **Adopt three external annotation standards and one internal model.** Externally: GeoJSON in the QuPath dialect (the de-facto exchange format of computational pathology; Paquo, wsireg, shapely/geopandas all speak it), DICOM Microscopy Bulk Simple Annotations (ANN, SOP class 1.2.840.10008.5.1.4.1.1.91.1; the only standard built for millions of cells and the one IDC/Slim/highdicom/wsidicom already use), and W3C Web Annotation (the IIIF/Annotorious world, for human ROI-level annotations). Internally: a columnar, GeoArrow-shaped model (typed arrays, per-feature class/measurement columns, packed Hilbert R-tree) that all three map onto losslessly **[verified: specs/sources below]**.
2. **Millions of polygons are a level-of-detail problem, not a rendering-engine problem.** deck.gl's own guidance is ~1 M items at 60 fps and 10–20 fps approaching 10 M **[verified, deck.gl performance guide]**; a 1 M-nucleus slide is ~22 M triangles, 5–10× over a low-end mobile frame budget **[estimate]**. The fix is to tile annotations on the *same* pyramid grid as the pixels (MVT-style tiles, 4096 extent, pre-cut at ingest, served from a PMTiles-style single file by HTTP range) and switch representation per level: instanced points → simplified polygons → full polygons, with raster label images as the fallback for the densest layers. This must be designed into the core scheduler from day one, otherwise every overlay later becomes a zoom-stutter source.
3. **Rasters are the robust path for AI output.** Segmentations and probability maps should travel as integer label pyramids (OME-Zarr `labels` with `image-label` colours/properties; DICOM Segmentation incl. the new LABELMAP type from Sup 243; DICOM Parametric Map) and be coloured in the shader with nearest sampling and a LUT; vector cell outlines are an *export* of a label image, not the primary store.
4. **Fluorescence is solved in the open ecosystem; copy it, do not reinvent.** Viv (0.23.0, deck.gl 9.4) demonstrates the required model: per-channel 16-bit textures (`r16uint`/`r32float`), per-channel contrast limits and colour, additive blending, up to 10 channels per pass, colormaps and a lens **[verified: source]**. OME-Zarr's transitional `omero` block and DICOM Optical Paths carry the rendering settings. Our Rust/wgpu core should port Viv's shader semantics, not depend on deck.gl in the hot path.
5. **Coordinates: one physical frame per slide, affine per layer.** DICOM ANN 3D (mm, slide frame of reference), OME-Zarr `coordinateSystems`/`coordinateTransformations` (NGFF 0.6 text; RFC-5 at stage S3) and QuPath pixel coordinates + MPP all reduce to "µm in the slide frame with a per-layer affine". Multi-slide registration (VALIS, wsireg) then becomes a camera transform (rigid/affine, free) or a displacement-field texture (non-rigid, one extra texture fetch per fragment).
6. **Integration surface = DICOMweb + IIIF + OME-Zarr + URL-launch + anywidget + web component.** These are mature and sufficient: Slim shows a full DICOMweb-only viewer with OIDC/PKCE; Vizarr shows anywidget (Jupyter/JupyterLab/Colab/VS Code/marimo) wrapping a web viewer with zero Python rendering code; IIIF Image API 3.0 and DeepZoom are trivial tile-source adapters. LIS/PACS launch is a URL-with-identifiers contract plus token exchange; there is no pathology-specific standard worth waiting for **[unverified: IHE DPIA status]**.
7. **Extensibility rule: plugins add data, never frame work.** Plugins contribute tile sources, layers (as GPU-ready buffers/textures), tools, panels and commands via a manifest (OHIF `id/version/modules/lifecycle`, napari npe2 manifest are the models); no plugin callback runs inside the render loop. Collaboration should ride on Yjs/yrs (CRDT with Rust, Wasm, Python, Swift, Kotlin bindings) with viewports and cursors as ephemeral *awareness*, never as document state.
8. **Accessibility is now normative for a pan/zoom viewer.** WCAG 2.2 SC 2.5.7 (Dragging Movements, AA) requires a single-pointer alternative to every drag (pan/zoom/annotation-move) and SC 2.5.8 requires 24×24 CSS px targets **[verified: WCAG understanding docs]**. Keyboard pan/zoom, tap-to-centre and `prefers-reduced-motion` are MVP items, not polish.

---

## Findings

### F1. Annotation data models

| Model | Status / version | Geometry & coordinates | Semantics | Scale (features) | Binary efficiency | Who speaks it | Verdict for Stoipath |
|---|---|---|---|---|---|---|---|
| **GeoJSON (RFC 7946)** | IETF standard, 2016 **[not re-fetched]** | Point/Multi*/LineString/Polygon/GeometryCollection; spec mandates WGS84 — pathology abuses it with pixel coordinates (universal, non-conformant) | Free-form `properties` | 10⁴–10⁵ comfortable; 10⁶ is 100s of MB of JSON | Poor (text, float64 as text) | Everyone: QuPath, Paquo, wsireg, HistomicsTK/large_image (GeoJSON import/export) **[verified]**, shapely/geopandas | **Import/export format, not storage** |
| **QuPath GeoJSON dialect** | QuPath 0.7.0 released, 0.8.0 in progress **[verified changelog]** | GeoJSON `FeatureCollection`; ellipses become polygons **[verified docs]**; `plane` {c,z,t} on the ROI **[verified GsonTools.java]** | `properties`: `objectType` (annotation/detection/cell/tile/TMA core), `classification` {`name`\|`names`, `color`}, `measurements`, `isLocked`, `name`, `color` **[verified source/docs]**; object hierarchy (parent/children) is *not* carried in GeoJSON | Same as GeoJSON; QuPath itself renders millions in-app since 0.6 ("much improved performance for very complex annotations") **[verified changelog]** | Poor | QuPath, Paquo (supports QuPath 0.2.0 → 0.6.x, reads/writes projects) **[verified README]**, wsireg (warps QuPath GeoJSON) **[verified]** | **Adopt as the canonical exchange dialect; preserve its property names verbatim** |
| **DICOM Microscopy Bulk Simple Annotations (ANN, Sup 222)** | In the DICOM standard (PS3.3 A.87); SOP class `1.2.840.10008.5.1.4.1.1.91.1` **[verified highdicom source]** | Per Annotation Group: `GraphicType` ∈ {POINT, POLYLINE, POLYGON, ELLIPSE, RECTANGLE}; `AnnotationCoordinateType` 2D (Column,Row in the total pixel matrix; `PixelOriginInterpretation` VOLUME/FRAME) or 3D (X,Y,Z mm in the slide Frame of Reference); packed `PointCoordinatesData` (float32) or `DoublePointCoordinatesData`; `LongPrimitivePointIndexList` delimits polygons; `CommonZCoordinateValue`; `AnnotationAppliesToAllZPlanes/OpticalPaths` **[verified]** | Coded `AnnotationPropertyCategory/TypeCodeSequence` (CID 7151/8135), `AnnotationGroupGenerationType` MANUAL/SEMIAUTOMATIC/AUTOMATIC, algorithm identification, `RecommendedDisplayCIELabValue`; `MeasurementsSequence` = coded name + unit + one value per annotation **[verified]** | Designed for "thousands or even millions" per slide (highdicom docs) **[verified]** | Good (packed float arrays, retrievable as DICOMweb bulk data) | highdicom, wsidicom (Annotation/AnnotationGroup/Measurement hierarchy) **[verified]**, dicom-microscopy-viewer 0.49.5 / Slim 0.46.10 (render IDC TCGA nuclei ANN) **[verified]** | **Adopt as the clinical/archival bulk format; map 1:1 onto the internal columnar model** |
| **DICOM Comprehensive 3D SR, TID 1500/1410** | Standard | SCOORD3D ROIs in mm | Rich coded findings, measurements, qualitative evaluations | 10¹–10³ ROIs | Verbose | Slim stores *user-drawn* ROIs this way **[verified README]** | Support read/write for ROI-level clinical annotations; never for cells |
| **W3C Web Annotation Data Model** | W3C Recommendation 23 Feb 2017 **[verified]** | Target = image + `FragmentSelector` (`xywh`) or `SvgSelector`; JSON-LD | Bodies (`TextualBody`, `SpecificResource`), `motivation`/`purpose`, `Choice`/`Composite`/`List` **[verified]** | 10¹–10⁴ | Poor | Annotorious 3.9.5 (+ OpenSeadragon plugin) **[verified package.json]**, IIIF Presentation 3 annotation pages | Adopt for IIIF interop and human ROI annotations; map to internal model via SVG → polygon |
| **SpatialData (scverse) Shapes/Points/Labels** | Active; on-disk Zarr + Parquet; transforms follow the NGFF RFC-5 proposal **[verified design doc]** | Shapes = GeoPandas DataFrame (polygons/circles), Points = Parquet/dask, Labels = OME-Zarr label images; per-element coordinate systems | AnnData tables annotate regions | 10⁶–10⁷ (columnar) | Good (Parquet) | spatialdata, napari-spatialdata, Vitessce, 10x | Read natively (Python API path); informs the internal model |
| **GeoParquet 2.0 / GeoArrow 0.2** | GeoParquet 2.0 agreed, pending OGC approval, built on Parquet's native `geometry` logical types; GeoArrow 0.2 **[verified READMEs]** | Columnar native geometry (interleaved coordinate lists) | Arbitrary columns | 10⁷+ | Best; zero-copy to GPU via deck.gl binary interface (3.2 M points demo; polygon triangulation on up to 8 workers) **[verified deck.gl-geoarrow README]** | lonboard, GDAL, DuckDB **[not re-fetched]** | **Shape of the internal model and of the "bulk download" export** |

Interop pivots: QuPath ROIs are JTS geometries and export WKT/WKB **[verified docs]**; shapely/GEOS consume all of GeoJSON/WKB/GeoArrow; highdicom converts numpy (N×2 / N×3) arrays to ANN **[verified]**. So one internal representation (flat coordinate arrays + ring offsets + columns) round-trips to every row of the table.

### F2. Rendering massive annotation sets

Working numbers for a dense slide, 1 M nuclei, ~24 vertices each **[estimate]**: 48 M coordinates = 192 MB as float32 (96 MB as tile-local int16); ear-clipping yields ~22 triangles per polygon → ~22 M triangles. Earcut triangulates its whole benchmark set in ~445 ms on an M1 Pro **[verified README]**; a Mali-G52/G57 class phone GPU sustains a few million triangles per 16 ms frame **[estimate]**. Visible cell counts at typical densities (5 000 nuclei/mm², up to 20 000 in dense tumour) on a 1080p viewport at 0.25 µm/px base: 40× ≈ 0.13 mm² ≈ 650 cells; 20× ≈ 2.6 k; 10× ≈ 10 k; 5× ≈ 42 k; 2.5× ≈ 170 k; 1.25× ≈ 670 k **[estimate]**. Conclusion: full polygons are only needed at ≥ ~10–20×; below that, a nucleus is < 2 px and must be a point/quad or a raster.

| Technique | Mechanism | Capacity | Interactivity | Cost model | Notes / evidence |
|---|---|---|---|---|---|
| SVG/DOM overlay | One element per feature | 10³–10⁴ | Native hit-testing, CSS | Layout thrash; dies at 10⁵ | Annotorious/OSD-style; fine for human ROIs only |
| Canvas 2D | Immediate-mode paths per frame | 10⁴–10⁵ | Manual hit-testing | CPU bound, main thread | Default of most pathology viewers; stutters during zoom |
| GPU immediate (deck.gl `GeoJsonLayer`/`SolidPolygonLayer`/`ScatterplotLayer`) | Attributes built once, drawn per frame | ~1 M items at 60 fps; 10–20 fps toward 10 M **[verified deck.gl perf guide]** | GPU picking | Attribute (re)generation "multiple seconds for multi-million item layers" on the main thread unless binary attributes supplied **[verified]** | Binary/GeoArrow input and worker triangulation remove the CPU wall **[verified deck.gl-geoarrow]** |
| **Vector tiles (MVT 2.1) on the image pyramid grid** | Pre-cut per (level, x, y); integer coords in a 4096 extent, zigzag/delta-encoded; `extent` + `buffer` for cross-tile features; feature `id` for cross-tile highlight (deck.gl `MVTLayer uniqueIdProperty`) **[verified MVT spec + deck.gl doc]**; MVT explicitly allows any projection/tile scheme **[verified]** | Unbounded (per-tile budget) | Per-tile picking index | Cutting is the expensive part (geojson-vt demo: 5.4 M points/100 MB in-browser; do it at ingest) | **Recommended**: a 4096 extent on a 512 px tile = 1/8 px precision; `binary: true` is 2–3× faster in deck.gl **[verified]**; lossy by design (simplification) |
| Single-file tile archive (PMTiles v3) | Hilbert-ordered tile IDs, root directory in the first 16 KiB, leaf directories, clustered tile data; HTTP range reads; MVT tile type **[verified spec]** | Unbounded | — | 1–2 range requests per tile cold, 1 warm | **Recommended sidecar** next to the pixel pyramid in object storage; same CDN/edge-auth story as pixel tiles |
| FlatGeobuf | Flatbuffers + optional packed Hilbert R-tree; bbox queries by HTTP range; lossless **[verified README]** | 10⁶–10⁷ | bbox filter | Range requests scale with query size; CDNs do not cache ranges well **[verified README note]** | Good for "download region" and server-side queries; not a render format |
| GeoArrow/GeoParquet | Columnar, zero-copy to GPU **[verified]** | 10⁷ | Column filters on GPU (data-filter extension) | One big load; no LOD by itself | Internal in-memory model; bulk export |
| Instanced rendering of centroids | 1 instance per cell (quad/circle), per-instance class colour/size | 10⁶–10⁷ at 60 fps on desktop; ~1 M on low-end mobile **[estimate]** | GPU picking by id | 8–16 B per instance | **Low-zoom LOD for cell layers**; TissUUmaps 3 ("millions of data points", WebGL2) is the precedent **[verified README]** |
| Simplification per LOD | Douglas–Peucker/Visvalingam at ingest; drop polygons < N px; collapse to centroid | — | — | Storage ×(levels) but each level small | geojson-vt `tolerance`, `buffer`, `indexMaxPoints` parameters are the knobs **[verified]** |
| Spatial index | Packed Hilbert R-tree (Flatbush: static, millions of boxes, bbox + kNN) **[verified]** | 10⁷ | Hover/select in < 1 ms | Build once per tile/layer in a worker | Ship the index *with* the tile (FlatGeobuf-style) so no client-side build |
| Raster label image | Integer label pyramid, LUT in shader | Unbounded | Picking = read label at pixel | One texture fetch per fragment | **Fallback for the densest layers and the primary form of AI segmentation** (F3) |

Ingest pipeline implied: GeoJSON/ANN/label-image → internal columns → (a) full-resolution GeoArrow + Hilbert index for queries/export, (b) per-level vector tiles (points at coarse levels, simplified polygons mid, full polygons fine) in a PMTiles-style archive, (c) optional rasterised label pyramid. Cross-tile features are duplicated into the buffer and de-duplicated by `id` at highlight time, exactly as web maps do.

### F3. Overlays: heatmaps, masks, AI results

| Overlay type | Standard containers | Raster vs vector | Rendering | Pitfalls |
|---|---|---|---|---|
| Instance/semantic segmentation | OME-Zarr `labels/<name>` (integer dtype required; `image-label` with `colors`, `properties`, `source`; multiscale; optional identity/scale/translation transform to the parent image) **[verified NGFF 0.6 text]**; DICOM Segmentation BINARY/FRACTIONAL and LABELMAP (Sup 243) **[verified highdicom enum + Slim README]**; QuPath `LabeledImageServer` binary vs labeled export **[verified docs]** | **Raster primary**; vector outlines derived on demand (marching squares in a worker) | Nearest-neighbour sampling only; 16-bit label → RGBA via 65 536-entry LUT texture (256 KB); highlight/selection by writing to the LUT; opacity and class visibility per LUT entry | Pyramid downsampling must be mode/stride, never average; DICOM `TILED_SPARSE` segmentations at non-pyramid resolutions exist (Slim handles them) **[verified]**; multichannel binary masks allow overlapping classes (QuPath) |
| Probability / attention / saliency maps | DICOM Parametric Map **[verified Slim]**; OME-Zarr float or uint8 image with `omero` window; plain pyramid tiles | Raster | Bilinear sampling; colormap LUT (viridis/magma …); window/threshold in shader; blend modes (normal, multiply, screen) | Store as uint8/float16 pyramids with the same tile grid as pixels so the scheduler treats them as another channel |
| Per-cell classification / scores | ANN `MeasurementsSequence`; GeoJSON `measurements`; GeoArrow columns | Vector (point LOD) or rasterised score map | Colour by column in shader (data-driven styling) | Keep columns separate from geometry so re-colouring is a uniform change, not a re-upload |
| Tissue/ROI/tumour outlines (human or AI) | GeoJSON, ANN POLYGON, SR TID 1500, W3C | Vector | Path layer with constant screen-space width | Fill for huge polygons must be triangulated at ingest |
| Heatmap (density of events) | Compute from points at ingest into a raster pyramid | Raster | As probability map | Do not compute kernel density on the client per frame |

### F4. Multi-channel fluorescence rendering

Reference implementation facts (Viv 0.23.0, deck.gl/luma.gl 9.4 stable) **[verified source/changelog]**: `MAX_CHANNELS = 10`; dtype → texture format `Uint8→r8uint`, `Uint16→r16uint`, `Uint32→r32uint`, `Float32→r32float`, `Int8/16/32→r*sint`; props `contrastLimits` ([begin,end] per channel), `channelsVisible`, `colors`, `dtype`, `interpolation` (nearest default / linear); shader applies `apply_contrast_limits` per channel then additive combination; extensions provide colormaps (`COLORMAPS` list), a lens, and maximum/minimum intensity projection for volumes. Viv also renders OME-TIFF and OME-Zarr directly and is used by Vitessce and 10x Xenium **[verified README]**.

Metadata carrying rendering state: OME-Zarr `omero` (transitional) per channel: `active`, `color`, `coefficient`, `family` (linear/…), `inverted`, `label`, `window {start,end,min,max}` **[verified spec text]**; DICOM Optical Path Sequence per channel with ICC profile / palette **[not re-fetched]**; dicom-microscopy-viewer does "additive blending and coloring of monochromatic images of multiple optical paths" **[verified README]**. OMERO.iviewer notes failures above ~30 channels due to request-string length **[verified]** — channel settings must be a structured document, not URL parameters.

Design table:

| Decision | Recommendation | Why |
|---|---|---|
| Where compositing happens | Client GPU, always (server composite only as thin-client fallback, cf. sibling note 05 F9) | LUT/contrast change must be a uniform update (one frame), not a tile refetch |
| Texture format | `r16uint` (WebGL2 `R16UI`) or `r16float` per channel; 8-bit windowed first paint then 16-bit on settle (05 F9) | Memory: 512² × 2 B = 512 KB per channel tile; 10 channels × 60 tiles ≈ 300 MB — over the iPad budget, so only *visible* channels are resident |
| Channels per pass | 8 (WebGL2 guarantees 16 texture units; keep headroom for LUT/label textures) with multi-pass additive accumulation beyond 8 | Viv's 10 is a practical ceiling; 40-plex CyCIF needs passes |
| Transfer function | Per channel: window (lo,hi), gamma/`family`, colour, inverted, visible; global: additive vs max-blend; colormaps for single-channel | Matches `omero` and DICOM semantics; serialisable |
| Brightfield-in-same-model | Treat RGB brightfield as a 3-channel "composite" source with identity transfer | One renderer path, one state model |

### F5. Z-stacks, focus planes, time series

OME-Zarr images are up to 5-D with typed axes (`space`/`time`/`channel`, units per UDUNITS-2) **[verified spec text]**; DICOM WSI expresses focal planes via Z offsets in the slide coordinate system **[not re-fetched]**. Viewer semantics: z and t are *dimensions of the same tile address*, so the tile key must be (layer, level, x, y, z, t, c); focus scrolling is a zoom-like gesture (prefetch z±1 of visible tiles; see 05 F8). Default display: extended-depth-of-field plane pre-computed at ingest, with z-planes on demand; MIP for fluorescence stacks (Viv has it). Time series: frame cache of the visible viewport only; playback at ≤ 10 fps is a tile-throughput problem, not a render problem.

### F6. Multi-slide synchronised viewing and registration

Tooling: VALIS (feature-based serial rigid registration towards a reference, optional mutual-information refinement, non-rigid and "micro-registration" at higher resolution, error estimated from matched features at full resolution; warps slides to OME-TIFF and warps point/polygon data) **[verified README]**; wsireg (elastix via ITKElastix, graph of modalities with arbitrary transformation paths, linear and non-linear models, composites all transforms into one interpolation, warps GeoJSON, exports OME-TIFF/OME-Zarr) **[verified README]**. ANHIR/ACROBAT challenge results **[not re-fetched]** put median landmark errors for H&E↔IHC in the tens of µm range after non-rigid registration — i.e. visually aligned at ≤ 10×, imperfect at 40×.

Standards for storing transforms: NGFF RFC-5 (status S3) / NGFF 0.6 text: `coordinateSystems` + `coordinateTransformations` with types `identity`, `mapAxis`, `translation`, `scale`, `affine`, `rotation`, `sequence`, `displacements`, `coordinates`, `bijection`, `byDimension`; parameters inline or as Zarr arrays; `scene` metadata relates multiple multiscale images **[verified spec/RFC text; 0.6 release status unverified]**. DICOM Spatial Registration / Deformable Spatial Registration IODs exist but WSI usage is rare **[unverified]**.

| Sync mode | Transform applied | Cost | UX |
|---|---|---|---|
| Lock pan/zoom (same frame) | identity | 0 | Side-by-side H&E/IHC from the same block after registration |
| Lock with rigid/affine offset | per-slide 3×3 in the camera | 0 (vertex shader) | Serial sections, rotated re-scans; exact and sharp |
| Non-rigid | displacement field (RFC-5 `displacements`) as a low-res 2-channel float texture sampled per fragment (or per vertex of a tile mesh grid) | +1 texture fetch per fragment; field is ≤ 1–4 MB per slide at 50 µm spacing **[estimate]** | Overlay/blend/curtain modes; resampling costs one bilinear tap — no visible blur if the pixel pyramid LOD is still chosen against the *warped* scale |
| Independent | none | 0 | Different cases / tumour board |

Implication: registration is a *layer transform*, so the core needs per-layer affine + optional displacement texture from day one; adding it later means touching the LOD selector (tile level must be chosen against the composed scale) and the prefetcher (predict in slide B's frame).

### F7. Measurement, calibration, scale bar, ICC colour management

- MPP sources: OME-Zarr `scale` transform on `space` axes with `unit: micrometer` **[verified]**; DICOM Pixel Spacing in Shared Functional Groups **[not re-fetched]**; OpenSlide `openslide.mpp-x/y` properties **[not re-fetched]**. Rule: the viewer never trusts "40×"; it uses µm/px and a magnification label is derived.
- Measurements (length, area, perimeter, count, angle) computed in slide µm; exported as GeoJSON `measurements`, ANN `MeasurementsSequence` (coded name/unit), SR TID 1410. Scale bar snaps to 1/2/5 × 10ⁿ µm and is drawn in the UI layer, never into tiles.
- Browser colour management **[verified MDN compat data]**: 2D canvas `colorSpace: "display-p3"` Chrome 92 / Safari 15.2 / Firefox none; WebGL `drawingBufferColorSpace` Chrome 104 / Firefox 132 / Safari 16.4; `unpackColorSpace` Chrome 104 / Firefox 132 / Safari none; WebGPU `GPUCanvasContext.configure` Chrome 144 / Chrome-Android 121 / Safari 26 / Firefox 141 (partial). So an in-browser ICC path exists only as "convert scanner profile → sRGB or Display-P3 in our shader", which is what dicom-microscopy-viewer does client-side **[verified README]** and QuPath 0.7 added for OpenSlide images **[verified changelog]**.
- Recommendation (aligned with note 03): for the 8-bit JPEG brightfield path apply the scanner ICC → sRGB on the server at tile generation (deterministic, cacheable, zero client cost); for raw-pixel sources (DICOM/OME-Zarr served natively) apply a 3D-LUT (33³ RGBA8 ≈ 144 KB) in the fragment shader; offer Display-P3 output where `drawingBufferColorSpace` exists. Display calibration of the monitor is out of scope but exposable via a "colour-managed display" flag in telemetry.

### F8. Split view, comparison, bookmarks, snapshots, export

State model: `{slides[], views[]: {slide, center_um, scale, rotation, z, t, channels[], overlays[], sync}}` serialisable to JSON and to a compact URL fragment; Slim's `?state=<UID>` parameter (a stored presentation state) and IIIF Content State **[not re-fetched]** are the precedents. Snapshot = GPU readback of the viewport (+ optional scale bar and annotation burn-in) → PNG/WebP; region export at full resolution is a *server* job (OME-TIFF/PNG, sibling note 02). Bookmarks are states plus thumbnail; galleries of bookmarks become the "tumour board" and teaching features.

### F9. Collaboration

Yjs: CRDT with shared cursors, offline editing, snapshots, undo/redo; providers y-websocket, y-webrtc, hosted (Liveblocks, Velt, y-sweet …) **[verified README]**. yrs is the Rust implementation with binary-protocol compatibility, plus ywasm, yffi (C ABI), pycrdt, yswift, ykt, ydotnet bindings **[verified README]** — it fits a Rust core compiled to Wasm and native, and pycrdt fits the Jupyter side. Design: annotation documents as `Y.Map<id, feature>` (so two pathologists can edit the same slide concurrently without conflicts); viewport, cursor, selection and "follow me" as *awareness* (ephemeral, ~10 Hz, dropped on disconnect), never persisted; bulk AI layers are immutable references, not CRDT content. Collaboration must not touch the render loop: remote cursors are a tiny instanced layer fed from awareness state.

### F10. Input

| Capability | Support (MDN compat data, verified) | Use |
|---|---|---|
| Pointer Events: `pressure`, `tiltX/Y`, `twist`, `tangentialPressure`, `pointerType` | Chrome 55+, Firefox 59+, Safari 13+ | Pen pressure-driven brush width; palm rejection via `pointerType` |
| `altitudeAngle`/`azimuthAngle` | Chrome 86, Firefox 131, Safari 18.2 | Pencil shading tools (later) |
| `getCoalescedEvents()` | Chrome 58, Firefox 59, Safari 18.2 (Firefox Android partial) | Smooth freehand polygons at native stylus rate |
| `getPredictedEvents()` | Chrome 77, Firefox 89, Safari 18.2 | Reduce perceived pen latency |
| `pointerrawupdate` | Chrome 77, Firefox 148, **Safari none** | Optional lower-latency sampling |
| Fractional pointer coordinates | Chrome 64 (partial), Firefox 135, Safari 26.2 | Sub-pixel annotation accuracy |
| Gamepad API (`axes`, `buttons`) | Chrome 21, Firefox 29, Safari 10.1 | Microscope-style stage controllers, accessibility switches; `vibrationActuator` Chrome 68 / Safari 16.4 only |
| `VisualViewport.scale` | Chrome 61, Firefox 91, Safari 13 | Detect browser pinch-zoom so the page does not zoom instead of the slide |

Gesture mapping to design in: wheel = zoom about cursor (with `ctrlKey` wheel = trackpad pinch), drag = pan, two-finger pinch/rotate on touch, Safari's non-standard `gesturestart/gesturechange` for trackpad pinch **[unverified: still needed in Safari 26]**, keyboard arrows/±/0/R, pen = annotate while a finger pans (pointer-type-aware tool routing), `touch-action: none` on the viewport. Native shells get predicted touches/Pencil hover and 120 Hz (sibling note 06); the web shell samples pointer events inside `requestAnimationFrame` and hands timestamped samples to the core.

### F11. Accessibility and internationalisation

WCAG 2.2 (AA) items that bind a pan/zoom viewer **[verified understanding docs]**: SC 2.5.7 Dragging Movements — every drag (pan, zoom slider, moving an annotation vertex) needs a single-pointer alternative (pan buttons, tap-to-centre, click-to-place); SC 2.5.8 Target Size — 24×24 CSS px minimum or equivalent spacing. Also from WCAG 2.1: keyboard operability (arrow keys pan, ±, Home), visible focus, `prefers-reduced-motion` (disable zoom inertia/animations while keeping content instant), 4.5:1 contrast for UI, no information by colour alone (overlay legends with patterns/labels). The canvas needs `role="application"`/`aria-label` plus a live region announcing position, magnification and selected annotation; annotation lists must be a real list for screen readers. OpenSeadragon only made its default buttons real `<button>` elements in its in-progress 6.2.0 **[verified changelog]** — the field baseline is low, so this is a differentiator.

i18n: all UI strings via ICU MessageFormat/Fluent with the `Intl` APIs for numbers, units (µm, mm², `Intl.NumberFormat` unit style), dates and plurals; RTL layout; no text rendered inside the GPU canvas except scale-bar numerals rendered from a glyph atlas; locale-aware units for measurements (µm vs um fallback where fonts lack µ).

### F12. Extensibility and integration patterns

Plugin-model precedents: OHIF — an extension is `{id, version, modules…, lifecycle hooks (preRegistration…)}` consumed by *modes* **[verified docs]**; napari npe2 — plugins declared by a manifest of contributions, loaded lazily **[verified README]**; Viv — layer extensions inject shader modules (`getVivShaderTemplates`, `DECKGL_MUTATE_COLOR`) **[verified changelog]**. OpenSeadragon's ecosystem is ad hoc (monkey-patching the viewer), which is why it is hard to keep fast.

| Extension point | Contract | Hot-path rule |
|---|---|---|
| Tile source | `describe() → pyramid geometry, dtype, channels, MPP, levels`; `fetch(tileKey) → bytes` (or URL template for the core fetcher) | Runs in a worker/native thread; the core decodes and caches |
| Raster layer | pyramid + transfer function + LUT | Data only; shader snippet whitelisted (contrast/colormap style), no arbitrary GLSL in v1 |
| Vector layer | GeoArrow buffers + style columns, or a vector-tile URL template | Buffers are uploaded by the core; no per-frame callbacks |
| Tool | pointer state machine → emits annotation ops (CRDT ops) | Runs on main thread between frames; must return in < 1 ms |
| Panel / command / menu | declarative manifest + UI framework component | Outside the canvas |
| Event bus | typed events (`viewChanged`, `tileSettled`, `annotationCreated`, `selectionChanged`) with batching per frame | Subscribers never block the frame; `viewChanged` is throttled to rAF |

Integration surface:

| Pattern | What we implement | Evidence / reference |
|---|---|---|
| **DICOMweb** | QIDO-RS search (studies/series/instances), WADO-RS metadata + multi-frame `frames` retrieval, bulk data for ANN coordinates, STOW-RS for saving SR/ANN; OIDC/OAuth2 PKCE | Slim runs fully client-side against any DICOMweb IMS/PACS/VNA and stores annotations as SR TID 1500 **[verified README]**; dicom-microscopy-viewer 0.49.5 uses `dicomweb-client` and OpenLayers `ol` 10.7 **[verified package.json]**; sibling note 02 recommends a DICOMweb façade on our tile server |
| **IIIF** | Image API 3.0 tile source (`info.json` `tiles/scaleFactors`, `{region}/{size}/{rotation}/{quality}.{format}`) **[not re-fetched]**; Presentation 3 annotation pages (W3C model); Content State for deep links | OSD 6.1 added `tileQuality`/`extraQualities` for IIIF **[verified changelog]** — this is a trivial adapter |
| **OME-Zarr / NGFF** | Read 0.4 (Zarr v2) and 0.5 (Zarr v3 + sharding; RFC-2 status S4) **[verified]**; write 0.5 as canonical store (sibling 02/05); track 0.6 `coordinateSystems`/`scene` for registration metadata | zarrita.js supports v2/v3 and ZEP-2 sharding **[verified README]**; Viv/Vizarr/Vitessce read it; QuPath 0.6 reads/writes it **[verified changelog]** |
| **DeepZoom (DZI)** | Read-only adapter (and a façade) | Ubiquitous legacy |
| **LIS/PACS launch** | URL contract (`/view?accession=…&case=…&slide=…&token=…`, or study/series UIDs IID-style), token exchange (OIDC), optional SMART-on-FHIR launch for EHR context, result write-back via FHIR `DiagnosticReport`/HL7 v2 ORU **[unverified: vendor specifics; IHE DPIA profile status]** | Every incumbent viewer is launched this way; keep the contract tiny and versioned |
| **Jupyter / Python** | anywidget 0.11.0 (Jupyter, JupyterLab, Colab, VS Code, marimo) wrapping the same ESM bundle; Python package serving local tiles; GeoJSON/ANN/GeoArrow in and out | Vizarr is exactly this architecture (anywidget Python API, zarrita client-side) **[verified READMEs]**; Vitessce has vitessce-python **[verified]** |
| **Web component / iframe** | `<stoipath-viewer>` custom element; `<iframe>` + JSON-RPC over `postMessage` with origin allow-list for hosts that cannot set COOP/COEP (sibling 06) | Same state model as F8 is the API surface |
| **Native SDKs** | UniFFI/C-ABI bindings (sibling 06) exposing the same layer/annotation/state API | — |

---

## Implications for our viewer

1. **Every overlay is a pyramid and goes through the same scheduler.** Annotations, label rasters, probability maps and fluorescence channels must be addressed with the same tile key as pixels and prioritised by the same predictive scheduler/cache (notes 04/05). If vector layers bypass the scheduler (as deck.gl layers over OpenSeadragon do today), they fetch and triangulate at the wrong moment and the zoom stutters. This is the single most important "design in from day one" item in this dimension.
2. **No per-feature CPU work on the main thread during interaction.** Vector tiles are decoded, simplified and indexed in workers/native threads; the core owns GPU buffers; styling is columns + uniforms; picking is a Hilbert index query in a worker or a GPU id read. deck.gl's own guidance ("supply attributes directly", binary data) is the ceiling of what a JS-attribute pipeline can do; our Rust/wgpu core should never generate attributes in JS.
3. **One coordinate frame.** Slide physical frame in µm with per-layer affine (+ optional displacement texture). DICOM 3D mm, OME physical axes, QuPath pixels × MPP, IIIF/DeepZoom pixel grids all map into it. The LOD selector must read the composed per-layer scale, or registered slides blur.
4. **Frame budget is partitioned.** Reserve (e.g.) 60 % of the frame for pixel tiles, 25 % for overlays, 15 % for UI; when over budget, degrade overlays first (drop to centroid LOD, skip label raster at ≥ 1:1), never the pixels. This policy lives in the core, not in plugins.
5. **Memory budget includes overlays.** On an iPad with ~256 MB of GPU tile cache (note 03), a 10-channel fluorescence view plus a 16-bit label pyramid plus vector buffers must fit; only visible channels resident, 8-bit first paint, label LUT instead of RGBA label textures.
6. **Standards live at the edges.** Internal GeoArrow-shaped model; adapters for GeoJSON/QuPath, ANN, SR, W3C, SpatialData, label images. This keeps the hot path independent of any standard's quirks (JSON floats, DICOM sequences, JSON-LD).
7. **Rendering settings are state, state is the API.** Channel windows, LUTs, overlays, sync and bookmarks are one JSON document that drives the web component, the iframe API, the anywidget, the native SDKs and collaboration — and round-trips to `omero` and DICOM presentation metadata.
8. **Platform ceilings shape features, not the other way round.** Safari has no `pointerrawupdate`, no `unpackColorSpace`; Firefox has no canvas `colorSpace`; WebGPU is absent on Firefox Android/WebView. Each feature in the MVP must have a WebGL2 + standard Pointer Events implementation; enhancements are feature-detected.

---

## Recommendations

### Prioritised feature space

| Tier | Feature | Rationale | Must be designed in from day one? |
|---|---|---|---|
| **MVP** | Brightfield + 16-bit multichannel (≤ 8 channels/pass, per-channel window/colour/visibility, additive) | Covers clinical H&E/IHC and research mIF; Viv proves the model | **Yes** — texture formats, channel-group tile key, transfer-function uniforms |
| MVP | Layer model: raster tile layers, raster overlay (label/probability) layers, vector layers; per-layer affine; opacity/blend | Everything else is a layer | **Yes** |
| MVP | Annotation core: point/polygon/polyline/rectangle/ellipse/freehand; classes; measurements (length/area); undo; GeoJSON (QuPath dialect) import/export; W3C import | Table-stakes; exchange with QuPath/Python | **Yes** for the internal columnar model + Hilbert index; UI tools can iterate |
| MVP | Massive-annotation path: ingest → vector tiles on the pixel grid + centroid LOD + raster-label fallback; PMTiles-style archive served by range | Goal 1 under AI overlays | **Yes** — scheduler/cache integration |
| MVP | MPP calibration, scale bar, magnification derived from µm/px | Trust | Yes (state model) |
| MVP | Tile sources: OME-Zarr 0.4/0.5, DICOMweb (QIDO/WADO-RS frames), IIIF Image 3.0, DZI, plus our native bundle protocol (note 02) | Reach | Yes (source abstraction in the core) |
| MVP | Keyboard + pointer + touch + pen input; WCAG 2.2 2.5.7/2.5.8; reduced-motion; i18n scaffolding | Normative; cheap now, expensive later | Yes (gesture router, string catalogue) |
| MVP | Deep-linkable view state; snapshots (PNG with scale bar) | Reporting, support, sharing | Yes (state document) |
| MVP | Web component + iframe/postMessage API; anywidget package | Embedding is goal 2 | Yes (state = API) |
| **v1** | DICOM ANN read/write; SR TID 1500 read/write; DICOM SEG (BINARY/FRACTIONAL/LABELMAP) and Parametric Map read | Clinical interoperability (IDC, PACS/VNA deployments) | Adapters only |
| v1 | Split view / N-up with sync modes (lock, affine offset); registration import (VALIS/wsireg → RFC-5 affine); overlay/curtain compare | Serial sections, IHC panels | Camera supports per-view transforms from MVP |
| v1 | Z-stack focus scrolling + EDF default; time series playback | Cytology, research | Tile key already has z/t |
| v1 | ICC: server-side for JPEG path (MVP), shader 3D-LUT for raw sources, Display-P3 output | Colour fidelity | LUT slot in shader reserved in MVP |
| v1 | Plugin API v1 (tile source, layer, tool, panel, command; manifest; event bus); SpatialData/GeoParquet read | Ecosystem | Internal interfaces already exist; freeze names here |
| v1 | Bookmarks galleries; region export (server) | Teaching, tumour board | — |
| **Later** | Non-rigid registration display (displacement textures), groupwise alignment of IHC panels | Research; perf risk on mobile | Reserve the per-layer displacement slot in the LOD math |
| Later | Live collaboration (Yjs/yrs): shared annotations, cursors, follow mode; pointer/presence | Needs auth/infra; valuable for education/consults | Keep annotations as op-based edits from MVP so CRDT is a transport swap |
| Later | Gamepad/stage-controller input; Pencil hover/altitude tools; pointerrawupdate path | Niche | Gesture router already abstracts devices |
| Later | OME-Zarr 0.6 `scene`/`coordinateSystems` write; DICOM Spatial Registration export | Standards still moving | — |
| Later | Native SDK plugin surface (Qt/C ABI) and QuPath bridge | Sibling note 06 stage 4 | — |

### Architecture decisions to lock now

1. Internal annotation model = GeoArrow-style flat coordinate buffers + ring offsets + typed columns + packed Hilbert R-tree; all formats are adapters.
2. Vector overlays are tiled on the pixel pyramid grid (same tile size, same levels, 4096 extent, 64-unit buffer) and pre-cut at ingest with per-level representation switching; stored as a single range-readable archive beside the pixel pyramid.
3. Label and probability rasters are first-class tile layers with nearest/bilinear sampling flags and LUT textures; AI vendors deliver pyramids, not polygons, unless they also deliver tiles.
4. Fluorescence: per-channel 16-bit textures, in-shader transfer functions, channel-group bundles (note 05), settings document compatible with `omero`.
5. One µm slide frame; per-layer affine from MVP; displacement-texture slot reserved.
6. State document = public API (web component props, postMessage, anywidget traitlets, UniFFI). Version it from 0.1.
7. Plugins never run in the frame loop; the manifest/capability model follows OHIF/npe2.
8. Accessibility and input routing are core features with CI checks (keyboard-only pan/zoom test, 24 px target lint, reduced-motion test).

---

## Open questions

1. **NGFF 0.6 release status.** The spec text on `ome/ngff-spec` main is titled "Version 0.6" and includes RFC-5 coordinate systems/transformations and `scene`, but RFC-5 is listed at stage S3; confirm whether 0.6 is released and which readers (zarrita, ome-zarr-py, QuPath, Viv) consume it before writing registration metadata in that form.
2. **Is there any vector annotation spec inside NGFF?** None in the 0.6 text; SpatialData (GeoPandas/Parquet) is the de-facto standard. Decide whether we standardise on SpatialData's on-disk layout for bulk vector export or on GeoParquet 2.0 directly (OGC approval pending).
3. **DICOM ANN scale limits in practice.** How do Google Healthcare API / commercial VNAs handle 10⁶-point `PointCoordinatesData` bulk retrieval latency and size limits? Needs a benchmark against a real DICOMweb server.
4. **Server-side cutting of vector tiles.** Build vs reuse: tippecanoe/planetiler are geographic (Web Mercator) tools; we need a pixel-grid cutter. Is a Rust implementation (geozero + custom tiler) ≤ 2 engineer-weeks, and what is ingest time for 1 M polygons?
5. **Label-image picking at 16-bit vs 32-bit ids.** Slides with > 65 535 cells per layer need 32-bit labels; WebGL2 `R32UI` textures are fine but double memory. Decide tiling of label ids (per-tile id remap) vs 32-bit.
6. **LIS/PACS launch specifics.** Which vendors (Epic Beaker, Cerner, Sectra, Philips, Roche) are in scope, and do any require IHE IID-style parameters or SMART-on-FHIR rather than a plain URL + token? The IHE pathology (DPIA) profile status is unverified.
7. **Safari gesture handling.** Whether Safari 26 still requires the non-standard `gesturestart/gesturechange` events for trackpad pinch (vs. `wheel` + `ctrlKey`) must be tested on hardware.
8. **Collaboration transport.** Self-hosted y-websocket vs. hosted providers vs. our own WebSocket in the tile server (note 05 reserves WebSocket for viewport hints and collaboration); PHI constraints will decide.
9. **Colour-managed display certification.** Whether any customer requires display-calibration validation (e.g., for primary diagnosis) beyond ICC-to-sRGB transforms.

---

## References

Primary sources fetched on 2026-10-24 (GitHub raw unless noted):

- OME-NGFF specification text (Version 0.6, `ome/ngff-spec` main): https://github.com/ome/ngff-spec/blob/main/index.md — `coordinateSystems`, `coordinateTransformations`, `multiscales`, `omero` (transitional), `labels`/`image-label`, `scene`.
- NGFF RFC index and RFC-2 (Zarr v3, S4), RFC-5 (Coordinate Systems and Transformations, S3), RFC-8 (Collections), RFC-9 (Zipped OME-Zarr): https://github.com/ome/ngff/tree/main/rfc
- highdicom ANN documentation and source (`highdicom.ann`): https://github.com/ImagingDataCommons/highdicom/blob/master/docs/ann.rst , https://github.com/ImagingDataCommons/highdicom/tree/master/src/highdicom/ann ; segmentation types incl. LABELMAP: https://github.com/ImagingDataCommons/highdicom/blob/master/src/highdicom/seg/enum.py
- dicom-microscopy-viewer README and package.json (v0.49.5): https://github.com/ImagingDataCommons/dicom-microscopy-viewer
- Slim README and package.json (v0.46.10): https://github.com/ImagingDataCommons/slim
- wsidicom README (annotation hierarchy): https://github.com/imi-bigpicture/wsidicom
- dicomweb-client: https://github.com/ImagingDataCommons/dicomweb-client
- QuPath CHANGELOG (0.6.0, 0.7.0, 0.8.0-in-progress): https://github.com/qupath/qupath/blob/main/CHANGELOG.md ; GeoJSON serialisation `GsonTools.java`: https://github.com/qupath/qupath/blob/main/qupath-core/src/main/java/qupath/lib/io/GsonTools.java ; exporting annotations docs: https://github.com/qupath/qupath-docs/blob/main/docs/advanced/exporting_annotations.md
- Paquo README: https://github.com/bayer-science-for-a-better-life/paquo
- W3C Web Annotation Data Model (Recommendation, 23 Feb 2017): https://www.w3.org/TR/annotation-model/ (fetched from https://github.com/w3c/web-annotation)
- Annotorious 3.9.5 and OpenSeadragon plugin: https://github.com/annotorious/annotorious
- OpenSeadragon changelog (6.1.1 released; 6.2.0 in progress): https://github.com/openseadragon/openseadragon/blob/master/changelog.txt
- Viv README, `packages/main` CHANGELOG (0.23.0), constants (`MAX_CHANNELS`, dtype formats), `xr-layer.js`: https://github.com/hms-dbmi/viv
- Vizarr README (anywidget Python API): https://github.com/hms-dbmi/vizarr ; Vitessce README: https://github.com/vitessce/vitessce
- anywidget README and package (0.11.0): https://github.com/manzt/anywidget ; zarrita.js README: https://github.com/manzt/zarrita.js
- deck.gl performance guide: https://github.com/visgl/deck.gl/blob/master/docs/developer-guide/performance.md ; MVTLayer: https://github.com/visgl/deck.gl/blob/master/docs/api-reference/geo-layers/mvt-layer.md ; GeoJsonLayer: https://github.com/visgl/deck.gl/blob/master/docs/api-reference/layers/geojson-layer.md ; What's New (v9.4, 2026-09-05): https://github.com/visgl/deck.gl/blob/master/docs/whats-new.md
- @geoarrow/deck.gl-geoarrow README: https://github.com/geoarrow/deck.gl-layers ; geoarrow-js: https://github.com/geoarrow/geoarrow-js ; GeoArrow spec 0.2: https://github.com/geoarrow/geoarrow ; GeoParquet 2.0: https://github.com/opengeospatial/geoparquet
- Mapbox Vector Tile spec 2.1: https://github.com/mapbox/vector-tile-spec/blob/master/2.1/README.md ; geojson-vt: https://github.com/mapbox/geojson-vt ; earcut: https://github.com/mapbox/earcut ; flatbush: https://github.com/mourner/flatbush
- PMTiles spec v3 and README: https://github.com/protomaps/PMTiles ; FlatGeobuf README: https://github.com/flatgeobuf/flatgeobuf
- SpatialData README and design document: https://github.com/scverse/spatialdata
- VALIS README: https://github.com/MathOnco/valis ; wsireg README: https://github.com/NHPatterson/wsireg
- TissUUmaps 3 / 4 READMEs: https://github.com/TissUUmaps/TissUUmaps3 , https://github.com/TissUUmaps/TissUUmaps
- Yjs README: https://github.com/yjs/yjs ; y-crdt (yrs, ywasm, yffi, bindings): https://github.com/y-crdt/y-crdt ; pycrdt: https://github.com/y-crdt/pycrdt
- OHIF extensions documentation: https://github.com/OHIF/Viewers/blob/master/platform/docs/docs/platform/extensions/index.md ; OHIF microscopy extension: https://github.com/OHIF/Viewers/tree/master/extensions/dicom-microscopy ; napari npe2: https://github.com/napari/npe2
- OMERO.iviewer README: https://github.com/ome/omero-iviewer ; large_image annotation docs (GeoJSON import/export): https://github.com/girder/large_image/blob/master/docs/annotations.rst
- MDN browser-compat-data (PointerEvent, Element pointer events, Gamepad, Navigator, HTMLCanvasElement.getContext, WebGLRenderingContext colour space, GPUCanvasContext, VisualViewport): https://github.com/mdn/browser-compat-data/tree/main/api
- WCAG 2.2 Understanding SC 2.5.7 Dragging Movements and SC 2.5.8 Target Size (Minimum): https://github.com/w3c/wcag/tree/main/understanding/22

Not re-fetched (blocked hosts; cited from memory, treat as unverified for dates/versions): GeoJSON RFC 7946 https://www.rfc-editor.org/rfc/rfc7946 ; IIIF Image API 3.0 https://iiif.io/api/image/3.0/ and Presentation API 3.0 https://iiif.io/api/presentation/3.0/ ; DICOM PS3.3 A.87 (ANN) https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_A.87.html and PS3.18 DICOMweb https://dicom.nema.org/medical/dicom/current/output/chtml/part18/PS3.18.html ; SMART App Launch https://hl7.org/fhir/smart-app-launch/ ; IHE Invoke Image Display and Digital Pathology profiles https://www.ihe.net/ ; OpenSlide properties https://openslide.org/api/python/ .
