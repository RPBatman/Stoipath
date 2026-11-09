//! Minimal 'stoi-render-gl'-shaped floor renderer: WebGL2 via web-sys, one 64-layer 512^2 RGBA8 texture array,
//! instanced textured quads (rect + layer per instance from a vertex buffer, compat-mode-safe), a slot map and a
//! visible-tile computation. Purpose: bound the gz size of the option-C floor module (renderer + glue), not to be complete.
use std::collections::HashMap;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::{WebGl2RenderingContext as GL, WebGlBuffer, WebGlProgram, WebGlShader, WebGlTexture, WebGlUniformLocation, WebGlVertexArrayObject};

const VS: &str = r#"#version 300 es
layout(location=0) in vec2 a_pos;      // unit quad
layout(location=1) in vec4 a_rect;     // x,y,w,h in world px (per instance)
layout(location=2) in float a_layer;   // array layer (per instance)
uniform mat3 u_view;                   // world -> clip
out vec3 v_uv;
void main(){ vec2 w = a_rect.xy + a_pos * a_rect.zw; vec3 c = u_view * vec3(w,1.0); gl_Position = vec4(c.xy,0.0,1.0); v_uv = vec3(a_pos, a_layer); }"#;
const FS: &str = r#"#version 300 es
precision mediump float; precision mediump sampler2DArray;
uniform sampler2DArray u_tex; in vec3 v_uv; out vec4 o;
void main(){ o = texture(u_tex, v_uv); }"#;

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct TileKey { pub level: u8, pub x: u32, pub y: u32 }

#[cfg(feature = "deps")]
#[derive(serde::Deserialize)]
pub struct Manifest { pub levels: Vec<LevelDesc>, pub tile: u32 }
#[cfg(feature = "deps")]
#[derive(serde::Deserialize)]
pub struct LevelDesc { pub w: u32, pub h: u32, pub url: String }

#[wasm_bindgen]
pub struct Viewer {
    gl: GL, prog: WebGlProgram, tex: WebGlTexture, vao: WebGlVertexArrayObject, inst: WebGlBuffer, u_view: WebGlUniformLocation,
    #[cfg(feature = "deps")] slots: hashbrown::HashMap<TileKey, u16>,
    #[cfg(not(feature = "deps"))] slots: HashMap<TileKey, u16>,
    free: Vec<u16>, lru: Vec<TileKey>, cx: f64, cy: f64, scale: f64, w: f64, h: f64, inst_data: Vec<f32>,
    #[cfg(feature = "deps")] manifest: Option<Manifest>,
}

fn shader(gl: &GL, ty: u32, src: &str) -> Result<WebGlShader, JsValue> {
    let s = gl.create_shader(ty).ok_or("shader")?; gl.shader_source(&s, src); gl.compile_shader(&s);
    if gl.get_shader_parameter(&s, GL::COMPILE_STATUS).as_bool() == Some(true) { Ok(s) } else { Err(gl.get_shader_info_log(&s).unwrap_or_default().into()) }
}

#[wasm_bindgen]
impl Viewer {
    #[wasm_bindgen(constructor)]
    pub fn new(canvas_id: &str, layers: i32) -> Result<Viewer, JsValue> {
        let doc = web_sys::window().ok_or("window")?.document().ok_or("doc")?;
        let canvas = doc.get_element_by_id(canvas_id).ok_or("canvas")?.dyn_into::<web_sys::HtmlCanvasElement>()?;
        let gl = canvas.get_context("webgl2")?.ok_or("webgl2")?.dyn_into::<GL>()?;
        let prog = gl.create_program().ok_or("prog")?;
        gl.attach_shader(&prog, &shader(&gl, GL::VERTEX_SHADER, VS)?); gl.attach_shader(&prog, &shader(&gl, GL::FRAGMENT_SHADER, FS)?); gl.link_program(&prog);
        if gl.get_program_parameter(&prog, GL::LINK_STATUS).as_bool() != Some(true) { return Err(gl.get_program_info_log(&prog).unwrap_or_default().into()); }
        let tex = gl.create_texture().ok_or("tex")?; gl.bind_texture(GL::TEXTURE_2D_ARRAY, Some(&tex));
        gl.tex_storage_3d(GL::TEXTURE_2D_ARRAY, 1, GL::RGBA8, 512, 512, layers);
        gl.tex_parameteri(GL::TEXTURE_2D_ARRAY, GL::TEXTURE_MIN_FILTER, GL::LINEAR as i32); gl.tex_parameteri(GL::TEXTURE_2D_ARRAY, GL::TEXTURE_MAG_FILTER, GL::LINEAR as i32);
        gl.tex_parameteri(GL::TEXTURE_2D_ARRAY, GL::TEXTURE_WRAP_S, GL::CLAMP_TO_EDGE as i32); gl.tex_parameteri(GL::TEXTURE_2D_ARRAY, GL::TEXTURE_WRAP_T, GL::CLAMP_TO_EDGE as i32);
        let vao = gl.create_vertex_array().ok_or("vao")?; gl.bind_vertex_array(Some(&vao));
        let quad = gl.create_buffer().ok_or("buf")?; gl.bind_buffer(GL::ARRAY_BUFFER, Some(&quad));
        let q: [f32; 8] = [0., 0., 1., 0., 0., 1., 1., 1.];
        unsafe { let v = js_sys::Float32Array::view(&q); gl.buffer_data_with_array_buffer_view(GL::ARRAY_BUFFER, &v, GL::STATIC_DRAW); }
        gl.enable_vertex_attrib_array(0); gl.vertex_attrib_pointer_with_i32(0, 2, GL::FLOAT, false, 0, 0);
        let inst = gl.create_buffer().ok_or("buf")?; gl.bind_buffer(GL::ARRAY_BUFFER, Some(&inst));
        gl.enable_vertex_attrib_array(1); gl.vertex_attrib_pointer_with_i32(1, 4, GL::FLOAT, false, 20, 0); gl.vertex_attrib_divisor(1, 1);
        gl.enable_vertex_attrib_array(2); gl.vertex_attrib_pointer_with_i32(2, 1, GL::FLOAT, false, 20, 16); gl.vertex_attrib_divisor(2, 1);
        let u_view = gl.get_uniform_location(&prog, "u_view").ok_or("u_view")?;
        Ok(Viewer { gl, prog, tex, vao, inst, u_view, slots: Default::default(), free: (0..layers as u16).rev().collect(), lru: Vec::new(), cx: 0., cy: 0., scale: 1., w: canvas.width() as f64, h: canvas.height() as f64, inst_data: Vec::new(),
            #[cfg(feature = "deps")] manifest: None })
    }
    #[cfg(feature = "deps")]
    pub fn load_manifest(&mut self, json: &str) -> Result<(), JsValue> { self.manifest = Some(serde_json::from_str(json).map_err(|e| JsValue::from_str(&e.to_string()))?); Ok(()) }
    /// Upload one decoded 512^2 RGBA8 tile into a free (or LRU-evicted) layer; returns the layer.
    pub fn upload_tile(&mut self, level: u8, x: u32, y: u32, rgba: &[u8]) -> u16 {
        let key = TileKey { level, x, y };
        let layer = match self.free.pop() { Some(l) => l, None => { let victim = self.lru.remove(0); self.slots.remove(&victim).unwrap_or(0) } };
        self.gl.bind_texture(GL::TEXTURE_2D_ARRAY, Some(&self.tex));
        unsafe { let v = js_sys::Uint8Array::view(rgba);
            let _ = self.gl.tex_sub_image_3d_with_opt_array_buffer_view(GL::TEXTURE_2D_ARRAY, 0, 0, 0, layer as i32, 512, 512, 1, GL::RGBA, GL::UNSIGNED_BYTE, Some(&v)); }
        self.slots.insert(key, layer); self.lru.push(key); layer
    }
    pub fn set_view(&mut self, cx: f64, cy: f64, scale: f64) { self.cx = cx; self.cy = cy; self.scale = scale; }
    /// Visible tiles at level `level` (world px per level px = 2^level) for the current view, as a flat [level,x,y,...] list.
    pub fn visible(&self, level: u8) -> Vec<u32> {
        let s = (1u32 << level) as f64 * 512.0; let hw = self.w / self.scale / 2.0; let hh = self.h / self.scale / 2.0;
        let x0 = ((self.cx - hw) / s).floor().max(0.0) as u32; let x1 = ((self.cx + hw) / s).ceil().max(0.0) as u32;
        let y0 = ((self.cy - hh) / s).floor().max(0.0) as u32; let y1 = ((self.cy + hh) / s).ceil().max(0.0) as u32;
        let mut out = Vec::new(); for y in y0..y1 { for x in x0..x1 { out.extend_from_slice(&[level as u32, x, y]); } } out
    }
    pub fn render(&mut self, level: u8) -> u32 {
        let gl = &self.gl; gl.viewport(0, 0, self.w as i32, self.h as i32); gl.clear_color(0.1, 0.1, 0.1, 1.0); gl.clear(GL::COLOR_BUFFER_BIT);
        self.inst_data.clear(); let s = (1u32 << level) as f32 * 512.0;
        #[cfg(feature = "deps")] let _v = glam::DVec2::new(self.cx, self.cy).length();
        for (k, &layer) in self.slots.iter() { if k.level != level { continue; } self.inst_data.extend_from_slice(&[k.x as f32 * s, k.y as f32 * s, s, s, layer as f32]); }
        let n = (self.inst_data.len() / 5) as i32; if n == 0 { return 0; }
        let (sx, sy) = (2.0 * self.scale / self.w, -2.0 * self.scale / self.h);
        let m: [f32; 9] = [sx as f32, 0., 0., 0., sy as f32, 0., (-self.cx * sx) as f32, (-self.cy * sy) as f32, 1.];
        gl.use_program(Some(&self.prog)); gl.bind_vertex_array(Some(&self.vao)); gl.bind_buffer(GL::ARRAY_BUFFER, Some(&self.inst));
        unsafe { let v = js_sys::Float32Array::view(&self.inst_data); gl.buffer_data_with_array_buffer_view(GL::ARRAY_BUFFER, &v, GL::DYNAMIC_DRAW); }
        gl.uniform_matrix3fv_with_f32_array(Some(&self.u_view), false, &m); gl.active_texture(GL::TEXTURE0); gl.bind_texture(GL::TEXTURE_2D_ARRAY, Some(&self.tex));
        gl.draw_arrays_instanced(GL::TRIANGLE_STRIP, 0, 4, n); n as u32
    }
    pub fn resident(&self) -> u32 { self.slots.len() as u32 }
}
