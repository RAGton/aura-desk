import { useEffect, useMemo, useRef, useState } from "react";

export interface AuraSpaceBackdropProps {
  immersive?: boolean;
  /**
   * Forces the backdrop into its own dark "galaxy" identity regardless of the
   * global UI theme. Used by the cockpit so the cosmos never washes out to the
   * light page background. Defaults to false to preserve the current
   * theme-reactive behaviour outside the cockpit.
   */
  galaxyDark?: boolean;
}

interface StaticStar2D {
  readonly ux: number;
  readonly uy: number;
  readonly r: number;
  readonly fill: string;
}

interface StarVertexBufferData {
  readonly vertices: Float32Array;
  readonly totalCount: number;
  readonly staticCount: number;
  readonly staticFallback: readonly StaticStar2D[];
}

interface CameraTarget {
  yaw: number;
  pitch: number;
  zoom: number;
}

const STATIC_STAR_COUNT = 220;
const SPHERE_EXTRA_COUNT = 340;
const DIFFRACTION_COUNT = 4;
const TOTAL_STAR_COUNT = STATIC_STAR_COUNT + SPHERE_EXTRA_COUNT + DIFFRACTION_COUNT;
const FLOATS_PER_STAR = 10;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const PLANCK_CLASSES = [
  { rgb: [0.77, 0.88, 1.0], threshold: 0.16 },
  { rgb: [0.96, 0.97, 1.0], threshold: 0.48 },
  { rgb: [1.0, 0.95, 0.85], threshold: 0.72 },
  { rgb: [0.96, 0.78, 0.54], threshold: 0.88 },
  { rgb: [0.93, 0.68, 0.74], threshold: 1.0 },
] as const;

const DIFFRACTION_SPECS = [
  { x: -0.92, y: 0.34, z: -0.82, size: 22, rgb: [0.85, 0.93, 1.0] },
  { x: 1.08, y: 0.46, z: -0.78, size: 20, rgb: [1.0, 0.95, 0.86] },
  { x: 0.88, y: -0.44, z: -0.86, size: 19, rgb: [0.98, 0.82, 0.88] },
  { x: -0.38, y: 0.28, z: 0.88, size: 21, rgb: [0.85, 0.93, 1.0] },
] as const;

const STAR_ATTR_LAYOUT: ReadonlyArray<readonly [string, number, number]> = [
  ["aDir", 3, 0],
  ["aSize", 1, 12],
  ["aColor", 3, 16],
  ["aMeta", 3, 28],
];

const QUAD_VERTS = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

const SKY_VERT_SRC = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const SKY_FRAG_SRC = `
precision highp float;

varying vec2 vUv;
uniform vec2 uResolution;
uniform float uTime;
uniform float uYaw;
uniform float uPitch;
uniform float uZoom;
uniform float uInteractive;

float hash31(vec3 p) {
  p = fract(p * vec3(123.34, 456.21, 789.18));
  p += dot(p, p.yzx + 45.32);
  return fract((p.x + p.y) * p.z);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float nx00 = mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), u.x);
  float nx10 = mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), u.x);
  float nx01 = mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), u.x);
  float nx11 = mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), u.x);
  return mix(mix(nx00, nx10, u.y), mix(nx01, nx11, u.y), u.z);
}

float fbm4(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    value += amp * noise2(p);
    p = rot * p * 2.03 + vec2(17.1, 31.7);
    amp *= 0.5;
  }
  return value;
}

float fbm3D(vec3 p) {
  float value = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amp * noise3(p);
    p = p.yzx * 2.04 + vec3(13.7, 29.3, 41.1);
    amp *= 0.5;
  }
  return value;
}

float ridged2(vec2 p) {
  return 1.0 - abs(fbm4(p) * 2.0 - 1.0);
}

vec3 evalNebula(
  vec3 rd,
  vec3 dir,
  vec2 scale,
  vec3 colA,
  vec3 colB,
  vec3 colGlow,
  float time,
  float seed
) {
  float d = dot(rd, dir);
  if (d < 0.12) return vec3(0.0);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), dir));
  vec3 up = cross(dir, right);
  vec2 p = vec2(dot(rd, right), dot(rd, up)) / max(d, 0.2) * scale;
  float env = exp(-dot(p, p) * 2.1) * smoothstep(0.12, 0.42, d);
  if (env < 0.01) return vec3(0.0);

  vec2 flow = vec2(time * 0.024, -time * 0.016) * (0.7 + 0.3 * sin(seed));
  vec2 warp = vec2(fbm4(p * 2.8 + flow + seed), fbm4(p * 2.8 + vec2(4.7, 2.1) - flow * 0.7 + seed * 1.7));
  float cloud = fbm4(p * 4.4 + warp * 1.9 + flow * 0.5);
  float detail = fbm4(p * 9.2 - warp * 1.6 + flow * 0.4 + seed * 2.3);
  float dust = smoothstep(0.46, 0.82, fbm4(p * 6.0 - warp * 1.3 + seed));
  float breath = 0.5 + 0.5 * sin(time * 0.30 + cloud * 4.8 + seed);

  vec3 baseCol = mix(colA, colB, smoothstep(0.42, 0.82, cloud) * (0.65 + 0.35 * breath));
  baseCol += colGlow * smoothstep(0.54, 0.88, detail) * smoothstep(0.40, 0.84, cloud) * 0.46;
  return baseCol * env * smoothstep(0.22, 0.82, cloud * 0.72 + detail * 0.36) * exp(-dust * 1.2);
}

vec3 evalSpiralGalaxy(vec3 rd, vec3 galDir, vec3 galNormal, float galDist, float galScale, float time, float seed) {
  float facing = dot(rd, galDir);
  if (facing < 0.15) return vec3(0.0);

  vec3 galPos = galDir * galDist;
  float denom = dot(rd, galNormal);
  float safeDenom = sign(denom + 0.00001) * max(abs(denom), 0.12);
  vec3 hit = rd * max(dot(galPos, galNormal) / safeDenom, 0.1) - galPos;

  vec3 axisU = normalize(cross(vec3(0.0, 1.0, 0.0), galNormal));
  vec3 axisV = cross(galNormal, axisU);
  vec2 diskP = vec2(dot(hit, axisU), dot(hit, axisV)) * galScale;

  float rBulge = length(cross(rd, galDir)) * galDist * galScale;
  float rDisk = length(diskP);
  float galBound = smoothstep(1.22, 0.58, rDisk) * smoothstep(0.15, 0.42, facing);
  if (galBound <= 0.001) return vec3(0.0);

  float spin = time * (0.048 + 0.072 / (rDisk + 0.18)) + seed;
  float sCos = cos(spin);
  float sSin = sin(spin);
  vec2 rotP = vec2(diskP.x * sCos - diskP.y * sSin, diskP.x * sSin + diskP.y * sCos);

  vec2 warpQ = vec2(fbm4(rotP * 3.8 + vec2(0.0, time * 0.028) + seed), fbm4(rotP * 3.8 + vec2(5.2, 1.3) - vec2(time * 0.02, 0.0) + seed));
  vec2 warpR = vec2(fbm4(rotP * 7.6 + 2.1 * warpQ + vec2(1.7, 9.2)), fbm4(rotP * 7.6 + 2.1 * warpQ + vec2(8.3, 2.8)));
  vec2 warpedP = rotP + (warpR - 0.5) * 0.11;

  float rW = length(warpedP);
  float thetaW = atan(warpedP.y, warpedP.x);
  float logR = log(rW + 0.055);
  float arm2 = 0.5 + 0.5 * cos(2.0 * thetaW - 7.4 * logR + (warpQ.x - 0.5) * 1.85);
  float arm3 = 0.5 + 0.5 * cos(3.0 * thetaW - 9.8 * logR + 1.8 + (warpQ.y - 0.5) * 2.1);
  float filament = fbm4(warpedP * 10.5 + vec2(cos(thetaW), sin(thetaW)) * 0.48);
  float fineCloud = fbm4(warpedP * 21.0 + warpQ * 2.5);
  float armMask = mix(0.66, smoothstep(0.18, 0.84, (arm2 * 0.62 + arm3 * 0.38) * (0.38 + 0.96 * filament)), smoothstep(0.03, 0.14, rDisk));

  float birthWave = 0.5 + 0.5 * sin(time * 0.72 - rW * 16.0 + thetaW * 2.0 + fineCloud * 4.0);
  float bulgeCore = exp(-pow(rBulge * 10.2, 0.78));
  float bulgeTotal = (bulgeCore * 0.78 + exp(-rBulge * 4.8) * 0.34) * galBound;
  float diskEnvelope = exp(-rDisk * 2.75) * galBound;

  vec3 bulgeColor = mix(vec3(0.66, 0.44, 0.28), vec3(0.95, 0.74, 0.46), smoothstep(0.0, 0.58, bulgeCore));
  bulgeColor = mix(bulgeColor, vec3(1.0, 0.96, 0.85), pow(bulgeCore, 2.2));

  vec3 diskColor = mix(vec3(0.22, 0.19, 0.48), vec3(0.32, 0.58, 0.96), smoothstep(0.24, 0.78, armMask));
  diskColor = mix(vec3(0.82, 0.62, 0.44), diskColor, smoothstep(0.06, 0.24, rDisk));

  float hiiMask = smoothstep(0.60, 0.85, fineCloud) * smoothstep(0.42, 0.82, armMask) * smoothstep(0.08, 0.22, rDisk);
  vec3 hiiColor = mix(vec3(0.88, 0.32, 0.55), vec3(0.22, 0.82, 0.78), smoothstep(0.45, 0.85, warpR.x));
  diskColor = mix(diskColor, hiiColor * (0.85 + 0.42 * birthWave), hiiMask * 0.78);

  float dustPhase = 0.5 + 0.5 * cos(2.0 * thetaW - 7.4 * logR + 0.95 + (warpQ.y - 0.5) * 1.9);
  float dustFil = pow(clamp(ridged2(warpedP * 13.5 + vec2(3.7, -1.9) + warpQ * 2.0), 0.0, 1.0), 3.0);
  float dustOpacity = dustFil * (0.35 + 0.75 * dustPhase) * smoothstep(0.035, 0.11, rDisk) * smoothstep(0.76, 0.18, rDisk) * mix(0.55, 1.65, smoothstep(-0.20, 0.16, diskP.y));

  vec3 galaxyLight = bulgeColor * bulgeTotal + diskColor * diskEnvelope * (0.30 + 0.98 * armMask) * (0.72 + 0.45 * fineCloud) * (0.90 + 0.20 * hash21(floor(gl_FragCoord.xy)));
  return galaxyLight * vec3(exp(-dustOpacity * 1.4), exp(-dustOpacity * 1.8), exp(-dustOpacity * 2.3));
}

float evalMeteor(vec3 rd, vec3 a, vec3 b, float time, float period, float offset) {
  float pt = mod(time + offset, period);
  float active = smoothstep(0.0, 0.12, pt) * (1.0 - smoothstep(0.55, 1.05, pt));
  if (active <= 0.01) return 0.0;
  float ph = clamp(pt / 1.05, 0.0, 1.0);
  vec3 head = normalize(mix(a, b, ph));
  vec3 tail = normalize(mix(a, b, max(0.0, ph - 0.16 * active)));
  vec3 seg = head - tail;
  float len2 = max(dot(seg, seg), 0.00001);
  float projT = clamp(dot(rd - tail, seg) / len2, 0.0, 1.0);
  float dist = length(rd - (tail + seg * projT));
  return exp(-dist * 1100.0) * projT * active;
}

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 ndc = (vUv * 2.0 - 1.0) * vec2(aspect, 1.0);

  if (uInteractive < 0.5) {
    vec2 uvTop = vec2(vUv.x, 1.0 - vUv.y);
    vec3 fixedCol = mix(vec3(0.004, 0.008, 0.026), vec3(0.022, 0.044, 0.112), smoothstep(0.0, 1.0, 0.62 * (1.0 - uvTop.y) + 0.38 * uvTop.x) * 0.45);
    vec2 mwP = (uvTop - vec2(0.5, 0.48)) * vec2(aspect, 1.0);
    float mwBand = exp(-pow(mwP.y * 0.85 + mwP.x * 0.45, 2.0) * 4.5);
    fixedCol += mix(vec3(0.045, 0.075, 0.175), vec3(0.125, 0.165, 0.31), fbm4(mwP * 2.1 + vec2(3.1, 1.4))) * mwBand * 0.44;
    fixedCol += vec3(0.76, 0.84, 0.96) * smoothstep(0.9968, 0.9999, hash21(floor(gl_FragCoord.xy))) * 0.24;
    gl_FragColor = vec4(fixedCol, 0.96);
    return;
  }

  float fov = mix(1.00, 1.46, clamp((uZoom - 0.65) / 1.35, 0.0, 1.0));
  vec3 rdCam = normalize(vec3(ndc.x, ndc.y, -fov));
  float cosP = cos(uPitch);
  float sinP = sin(uPitch);
  float y1 = rdCam.y * cosP - rdCam.z * sinP;
  float z1 = rdCam.y * sinP + rdCam.z * cosP;
  float cosY = cos(uYaw);
  float sinY = sin(uYaw);
  vec3 rd = normalize(vec3(rdCam.x * cosY + z1 * sinY, y1, -rdCam.x * sinY + z1 * cosY));

  vec3 bhDir = normalize(vec3(-0.54, -0.18, -1.0));
  vec3 bhRight = normalize(cross(vec3(0.0, 1.0, 0.0), bhDir));
  vec3 bhUp = cross(bhDir, bhRight);
  float bhDot = dot(rd, bhDir);
  vec2 bhRaw = vec2(dot(rd, bhRight), dot(rd, bhUp)) / max(bhDot, 0.25);
  float bhRawR = length(bhRaw);
  float rs = 0.044;

  vec3 lensedRd = rd;
  if (bhDot > 0.35 && bhRawR < 0.42) {
    float lensStr = (rs * rs * 1.55) / max(bhRawR * bhRawR + rs * rs * 0.32, 0.0001);
    vec3 toCenter = normalize(bhDir - rd * bhDot + vec3(0.00001));
    lensedRd = normalize(rd - toCenter * min(lensStr, 0.18) * 0.18);
  }

  vec3 col = mix(vec3(0.004, 0.008, 0.028), vec3(0.020, 0.040, 0.102), smoothstep(-0.6, 0.8, lensedRd.y) * 0.45);

  vec3 mwNormal = normalize(vec3(-0.38, 0.78, 0.50));
  float mwWarp = fbm3D(lensedRd * 2.2 + vec3(uTime * 0.008)) - 0.5;
  float mwDist = abs(dot(lensedRd, mwNormal) + mwWarp * 0.22);
  float mwBand = exp(-mwDist * mwDist * 14.0);
  float mwClouds = fbm3D(lensedRd * 4.4 + vec3(mwWarp * 0.6 + uTime * 0.006, 1.4, -0.8));
  float mwExt = exp(-smoothstep(0.42, 0.78, fbm3D(lensedRd * 7.2 + vec3(2.3, -1.1, 0.7))) * 1.7 * exp(-mwDist * mwDist * 30.0));
  col += mix(vec3(0.045, 0.068, 0.155), vec3(0.13, 0.15, 0.24), smoothstep(0.32, 0.78, mwClouds)) * mwBand * (0.35 + 0.65 * mwClouds) * mwExt * 0.62;

  col += evalNebula(lensedRd, normalize(vec3(-0.74, 0.44, -0.82)), vec2(1.4, 1.95), vec3(0.52, 0.12, 0.29), vec3(0.11, 0.56, 0.76), vec3(0.90, 0.60, 0.34), uTime, 1.1) * 0.54;
  col += evalNebula(lensedRd, normalize(vec3(0.86, -0.48, -0.74)), vec2(1.4, 1.85), vec3(0.24, 0.14, 0.54), vec3(0.10, 0.48, 0.70), vec3(0.72, 0.32, 0.64), uTime, 3.7) * 0.54;
  col += evalNebula(lensedRd, normalize(vec3(-0.46, 0.24, 0.85)), vec2(1.25, 1.65), vec3(0.58, 0.23, 0.18), vec3(0.14, 0.58, 0.50), vec3(0.94, 0.64, 0.30), uTime, 6.3) * 0.62;
  col += evalNebula(lensedRd, normalize(vec3(0.58, -0.22, 0.78)), vec2(1.4, 1.65), vec3(0.16, 0.28, 0.66), vec3(0.22, 0.74, 0.84), vec3(0.86, 0.36, 0.60), uTime, 9.2) * 0.60;

  col += evalSpiralGalaxy(lensedRd, normalize(vec3(0.72, 0.34, -1.0)), normalize(vec3(-0.34, 0.78, 0.52)), 2.35, 1.15, uTime, 0.0) * 0.86;
  col += evalSpiralGalaxy(lensedRd, normalize(vec3(-0.22, -0.28, 0.93)), normalize(vec3(0.45, 0.72, -0.53)), 3.1, 1.55, uTime * 1.15, 2.4) * 0.76;

  float bhBound = smoothstep(0.42, 0.26, bhRawR) * smoothstep(0.35, 0.65, bhDot);
  if (bhBound > 0.001) {
    vec2 bhP = vec2(bhRaw.x * 0.966 - bhRaw.y * 0.257, bhRaw.x * 0.257 + bhRaw.y * 0.966);
    float r = length(bhP);
    float angle = atan(bhP.y, bhP.x);
    float shadowMask = 1.0 - smoothstep(rs * 0.94, rs * 1.05, r);
    col *= (1.0 - shadowMask);

    float jetAxis = exp(-abs(bhP.x) * 44.0) * smoothstep(rs * 0.9, rs * 4.6, abs(bhP.y)) * exp(-abs(bhP.y) * 9.5) * bhBound;
    col += vec3(0.34, 0.58, 0.98) * jetAxis * (0.72 + 0.28 * sin(uTime * 1.3 - abs(bhP.y) * 24.0)) * 0.44;

    vec2 bhDiskUV = vec2(bhP.x, bhP.y / 0.24);
    float rDiskBH = length(bhDiskUV);
    float shearAng = atan(bhDiskUV.y, bhDiskUV.x) - uTime * (0.90 / (pow(max(rDiskBH, rs), 0.75) + 0.05)) - 4.8 * log(max(rDiskBH, 0.015));
    float plasmaStreaks = 0.55 + 0.75 * smoothstep(0.28, 0.82, fbm4(vec2(rDiskBH * 34.0, 0.0) + vec2(cos(shearAng), sin(shearAng)) * 2.3));
    float diskBand = smoothstep(rs * 1.14, rs * 1.46, rDiskBH) * exp(-(rDiskBH - rs * 1.24) * 14.5) * smoothstep(0.35, 0.14, rDiskBH);
    float frontOcclusion = mix(1.0 - shadowMask * 0.98, 1.0, smoothstep(-0.01, 0.035, bhDiskUV.y));

    float einsteinBand = exp(-pow((r - rs * 1.30) / (rs * 0.32), 2.0)) * pow(abs(bhP.y) / max(r, 0.0001), 0.9);
    float einsteinPlasma = 0.62 + 0.55 * fbm4(vec2(r * 42.0, 1.3) + vec2(cos(angle - uTime * 0.85), sin(angle - uTime * 0.85)) * 2.1);
    float photonRing = exp(-pow((r - rs * 1.08) / (rs * 0.10), 2.0));
    float doppler = clamp(1.0 - 0.36 * (bhP.x / max(r, 0.004)), 0.58, 1.42);

    vec3 hotPlasma = mix(vec3(0.88, 0.28, 0.12), vec3(1.0, 0.74, 0.32), smoothstep(0.28, 0.08, rDiskBH));
    hotPlasma = mix(hotPlasma, vec3(1.0, 0.96, 0.86), smoothstep(rs * 1.9, rs * 1.22, rDiskBH));

    vec3 diskEmission = hotPlasma * diskBand * plasmaStreaks * frontOcclusion * doppler * 1.25;
    vec3 lensedEmission = mix(vec3(1.0, 0.68, 0.28), vec3(1.0, 0.95, 0.84), 0.55) * einsteinBand * einsteinPlasma * doppler * 0.86;
    vec3 photonEmission = vec3(1.0, 0.94, 0.80) * photonRing * (0.82 + 0.18 * sin(angle * 3.0 - uTime * 2.4)) * doppler * 1.02;
    float outerCorona = exp(-max(r - rs, 0.0) * 18.0) * (1.0 - shadowMask) * 0.16;
    col += (diskEmission + lensedEmission + photonEmission + vec3(0.48, 0.32, 0.58) * outerCorona) * bhBound;
  }

  float shadowVoid = 1.0 - (1.0 - smoothstep(rs * 0.94, rs * 1.05, bhRawR)) * smoothstep(0.35, 0.65, bhDot);
  col += vec3(0.78, 0.86, 0.98) * smoothstep(0.992, 0.9998, hash31(floor(lensedRd * 420.0))) * (0.20 + 0.35 * mwBand) * shadowVoid;

  float m1 = evalMeteor(rd, normalize(vec3(0.65, 0.52, -0.95)), normalize(vec3(0.18, 0.24, -0.98)), uTime, 9.5, 1.8);
  float m2 = evalMeteor(rd, normalize(vec3(-0.15, 0.62, -0.92)), normalize(vec3(-0.58, 0.34, -0.95)), uTime, 13.0, 7.4);
  float m3 = evalMeteor(rd, normalize(vec3(-0.25, 0.45, 0.92)), normalize(vec3(0.22, 0.18, 0.95)), uTime, 15.0, 4.9);
  col += vec3(0.78, 0.88, 1.0) * m1 + vec3(1.0, 0.94, 0.84) * m2 + vec3(0.86, 0.95, 1.0) * m3;

  gl_FragColor = vec4(col, 0.96);
}
`;

const STAR_VERT_SRC = `
attribute vec3 aDir;
attribute float aSize;
attribute vec3 aColor;
attribute vec3 aMeta;

uniform vec2 uResolution;
uniform float uTime;
uniform float uYaw;
uniform float uPitch;
uniform float uZoom;
uniform float uDpr;
uniform float uInteractive;

varying vec3 vColor;
varying float vAlpha;
varying float vDiff;

void main() {
  vec3 bhDir = normalize(vec3(-0.54, -0.18, -1.0));
  vec3 p = aDir;

  if (uInteractive > 0.5) {
    float dotBh = dot(p, bhDir);
    if (dotBh > 0.4) {
      vec3 perp = p - bhDir * dotBh;
      float ang = length(perp);
      if (ang < 0.042) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 0.0;
        return;
      }
      if (ang < 0.28) {
        float shift = (0.044 * 0.044 * 1.35) / max(ang, 0.01);
        p = normalize(bhDir * dotBh + perp * (1.0 + shift / max(ang, 0.001)));
      }
    }
  }

  float yaw = uInteractive > 0.5 ? uYaw * aMeta.x : 0.0;
  float pitch = uInteractive > 0.5 ? uPitch : 0.0;
  float cosY = cos(yaw);
  float sinY = sin(yaw);
  float x1 = p.x * cosY - p.z * sinY;
  float z1 = p.x * sinY + p.z * cosY;
  float cosP = cos(pitch);
  float sinP = sin(pitch);
  float y2 = p.y * cosP + z1 * sinP;
  float z2 = -p.y * sinP + z1 * cosP;

  if (z2 >= -0.08) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  float aspect = uResolution.x / max(uResolution.y, 1.0);
  float fov = uInteractive > 0.5 ? mix(1.00, 1.46, clamp((uZoom - 0.65) / 1.35, 0.0, 1.0)) : 1.12;
  gl_Position = vec4((x1 * fov) / aspect, y2 * fov, -z2 * 0.5, -z2);

  float shimmer = uInteractive > 0.5 ? (0.76 + 0.24 * sin(uTime * (1.3 + aMeta.x * 1.4) + aMeta.y)) : 0.85;
  vColor = aColor;
  vAlpha = shimmer;
  vDiff = aMeta.z;
  gl_PointSize = aSize * uDpr;
}
`;

const STAR_FRAG_SRC = `
precision mediump float;

varying vec3 vColor;
varying float vAlpha;
varying float vDiff;

void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d2 = dot(p, p);
  if (vDiff > 0.5) {
    float core = exp(-d2 * 130.0);
    float crossH = exp(-abs(p.y) * 54.0) * exp(-abs(p.x) * 6.5);
    float crossV = exp(-abs(p.x) * 54.0) * exp(-abs(p.y) * 6.5);
    gl_FragColor = vec4(vColor, clamp(core + (crossH + crossV) * 0.45, 0.0, 1.0) * vAlpha);
  } else {
    gl_FragColor = vec4(vColor, exp(-d2 * 18.0) * vAlpha);
  }
}
`;

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function selectPlanckColor(roll: number): readonly [number, number, number] {
  for (let i = 0; i < PLANCK_CLASSES.length; i++) {
    if (roll <= PLANCK_CLASSES[i].threshold) return PLANCK_CLASSES[i].rgb;
  }
  return PLANCK_CLASSES[1].rgb;
}

function normalizeVec(x: number, y: number, z: number): readonly [number, number, number] {
  const inv = 1 / (Math.hypot(x, y, z) || 1);
  return [x * inv, y * inv, z * inv];
}

function writeStarEntry(
  buf: Float32Array,
  index: number,
  x: number,
  y: number,
  z: number,
  size: number,
  rgb: readonly [number, number, number],
  parallax: number,
  phase: number,
  isDiff: number
): void {
  const base = index * FLOATS_PER_STAR;
  buf[base] = x;
  buf[base + 1] = y;
  buf[base + 2] = z;
  buf[base + 3] = size;
  buf[base + 4] = rgb[0];
  buf[base + 5] = rgb[1];
  buf[base + 6] = rgb[2];
  buf[base + 7] = parallax;
  buf[base + 8] = phase;
  buf[base + 9] = isDiff;
}

function buildStarVertexData(): StarVertexBufferData {
  const rng = createSeededRng(0x41555243);
  const vertices = new Float32Array(TOTAL_STAR_COUNT * FLOATS_PER_STAR);
  const staticFallback: StaticStar2D[] = [];

  // First 220 stars populate the forward hemisphere evenly so non-Aura fixed screens look crisp
  for (let i = 0; i < STATIC_STAR_COUNT; i++) {
    const ux = rng();
    const uy = rng();
    const [x, y, z] = normalizeVec((ux - 0.5) * 2.2, (0.5 - uy) * 1.4, -1.0);
    const mag = rng();
    const size = mag > 0.88 ? 3.8 + rng() * 1.2 : 2.3 + rng() * 1.1;
    const rgb = selectPlanckColor(rng());
    writeStarEntry(vertices, i, x, y, z, size, rgb, 0.85 + rng() * 0.3, rng() * Math.PI * 2, 0);
    staticFallback.push({
      ux,
      uy,
      r: size * 0.32,
      fill: `rgba(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)}, 0.78)`,
    });
  }

  // Remaining 340 stars populate the full 360-degree celestial sphere
  for (let i = 0; i < SPHERE_EXTRA_COUNT; i++) {
    const yBase = 1 - ((i + 0.5) / SPHERE_EXTRA_COUNT) * 2;
    const rY = Math.sqrt(Math.max(0, 1 - yBase * yBase));
    const theta = i * GOLDEN_ANGLE + (rng() - 0.5) * 0.28;
    const [x, y, z] = normalizeVec(Math.cos(theta) * rY, yBase + (rng() - 0.5) * 0.08, Math.sin(theta) * rY);
    const mag = rng();
    const size = mag > 0.92 ? 4.4 + rng() * 1.6 : mag > 0.68 ? 2.8 + rng() * 1.1 : 1.8 + rng() * 0.9;
    const rgb = selectPlanckColor(rng());
    writeStarEntry(vertices, STATIC_STAR_COUNT + i, x, y, z, size, rgb, 0.78 + rng() * 0.44, rng() * Math.PI * 2, 0);
  }

  for (let i = 0; i < DIFFRACTION_SPECS.length; i++) {
    const d = DIFFRACTION_SPECS[i];
    const [x, y, z] = normalizeVec(d.x, d.y, d.z);
    writeStarEntry(vertices, STATIC_STAR_COUNT + SPHERE_EXTRA_COUNT + i, x, y, z, d.size, d.rgb, 1.0, i * 1.6, 1);
  }

  return { vertices, totalCount: TOTAL_STAR_COUNT, staticCount: STATIC_STAR_COUNT, staticFallback };
}

function compileProgram(gl: WebGLRenderingContext, vertSrc: string, fragSrc: string): WebGLProgram | null {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  if (!vs || !fs) return null;
  gl.shaderSource(vs, vertSrc);
  gl.shaderSource(fs, fragSrc);
  gl.compileShader(vs);
  gl.compileShader(fs);
  const prog = gl.createProgram();
  if (!prog || !gl.getShaderParameter(vs, gl.COMPILE_STATUS) || !gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

function bindUniforms(
  gl: WebGLRenderingContext,
  prog: WebGLProgram,
  w: number,
  h: number,
  entries: ReadonlyArray<readonly [string, number]>
): void {
  gl.uniform2f(gl.getUniformLocation(prog, "uResolution"), w, h);
  for (let i = 0; i < entries.length; i++) {
    gl.uniform1f(gl.getUniformLocation(prog, entries[i][0]), entries[i][1]);
  }
}

function renderFallback2D(ctx: CanvasRenderingContext2D, w: number, h: number, stars: readonly StaticStar2D[]): void {
  const grad = ctx.createLinearGradient(0, h, w, 0);
  grad.addColorStop(0, "#010207");
  grad.addColorStop(1, "#060d20");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    ctx.fillStyle = s.fill;
    ctx.beginPath();
    ctx.arc(s.ux * w, s.uy * h, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function AuraSpaceBackdrop({
  immersive: immersiveProp,
  galaxyDark = false,
}: AuraSpaceBackdropProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isLightTheme, setIsLightTheme] = useState(false);
  const [detectedAuraScreen, setDetectedAuraScreen] = useState(false);
  const starData = useMemo(() => buildStarVertexData(), []);
  const cameraTargetRef = useRef<CameraTarget>({ yaw: 0, pitch: 0, zoom: 1 });
  const immersive = immersiveProp !== undefined ? immersiveProp : detectedAuraScreen;

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setIsLightTheme(root.getAttribute("data-theme") === "light");
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (immersiveProp !== undefined) return;
    const syncAura = () => setDetectedAuraScreen(Boolean(document.querySelector('[data-testid="aura-pyramid-station"]')));
    syncAura();
    const observer = new MutationObserver(syncAura);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [immersiveProp]);

  useEffect(() => {
    if (!immersive) {
      cameraTargetRef.current = { yaw: 0, pitch: 0, zoom: 1 };
      return;
    }
    const onOrbit = (ev: Event) => {
      const detail = (ev as CustomEvent<Partial<CameraTarget>>).detail;
      if (!detail) return;
      cameraTargetRef.current = {
        yaw: typeof detail.yaw === "number" ? detail.yaw : 0,
        pitch: typeof detail.pitch === "number" ? detail.pitch : 0,
        zoom: typeof detail.zoom === "number" ? detail.zoom : 1,
      };
    };
    window.addEventListener("auradesk://camera-orbit", onOrbit);
    return () => window.removeEventListener("auradesk://camera-orbit", onOrbit);
  }, [immersive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl =
      (canvas.getContext("webgl2", { alpha: true, antialias: false }) as WebGLRenderingContext | null) ??
      canvas.getContext("webgl", { alpha: true, antialias: false });
    const ctx2d = gl ? null : canvas.getContext("2d");
    if (!gl && !ctx2d) return;

    let skyProg: WebGLProgram | null = null;
    let starProg: WebGLProgram | null = null;
    let quadBuf: WebGLBuffer | null = null;
    let starBuf: WebGLBuffer | null = null;

    if (gl) {
      skyProg = compileProgram(gl, SKY_VERT_SRC, SKY_FRAG_SRC);
      starProg = compileProgram(gl, STAR_VERT_SRC, STAR_FRAG_SRC);
      quadBuf = gl.createBuffer();
      starBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
      gl.bufferData(gl.ARRAY_BUFFER, starData.vertices, gl.STATIC_DRAW);
    }

    let dpr = 1;
    let rafId = 0;
    let startTime = 0;
    let lastTime = 0;
    let disposed = false;
    let curYaw = 0;
    let curPitch = 0;
    let curZoom = 1;

    const syncSize = () => {
      const w = Math.max(canvas.clientWidth || window.innerWidth, 1);
      const h = Math.max(canvas.clientHeight || window.innerHeight, 1);
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
      if (ctx2d) renderFallback2D(ctx2d, canvas.width, canvas.height, starData.staticFallback);
    };

    const drawFrame = (elapsedSec: number) => {
      if (!gl || !skyProg || !starProg) return;
      const mode = immersive ? 1 : 0;
      const shared: ReadonlyArray<readonly [string, number]> = [
        ["uTime", elapsedSec],
        ["uYaw", curYaw],
        ["uPitch", curPitch],
        ["uZoom", curZoom],
        ["uInteractive", mode],
      ];

      gl.disable(gl.BLEND);
      gl.useProgram(skyProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      const skyPos = gl.getAttribLocation(skyProg, "aPos");
      gl.enableVertexAttribArray(skyPos);
      gl.vertexAttribPointer(skyPos, 2, gl.FLOAT, false, 0, 0);
      bindUniforms(gl, skyProg, canvas.width, canvas.height, shared);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
      gl.useProgram(starProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
      for (let i = 0; i < STAR_ATTR_LAYOUT.length; i++) {
        const [name, size, offset] = STAR_ATTR_LAYOUT[i];
        const loc = gl.getAttribLocation(starProg, name);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, FLOATS_PER_STAR * 4, offset);
      }
      bindUniforms(gl, starProg, canvas.width, canvas.height, [...shared, ["uDpr", dpr]]);
      gl.drawArrays(gl.POINTS, 0, immersive ? starData.totalCount : starData.staticCount);
    };

    const motionQuery = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    const stopLoop = () => {
      if (rafId !== 0) cancelAnimationFrame(rafId);
      rafId = 0;
    };

    const animate = (ts: number) => {
      if (disposed) return;
      if (startTime === 0) startTime = lastTime = ts;
      const dt = Math.min(0.05, Math.max(0.001, (ts - lastTime) * 0.001));
      lastTime = ts;
      const ease = 1 - Math.exp(-dt * 9.5);
      const t = cameraTargetRef.current;
      curYaw += (t.yaw - curYaw) * ease;
      curPitch += (t.pitch - curPitch) * ease;
      curZoom += (t.zoom - curZoom) * ease;
      drawFrame((ts - startTime) * 0.001);
      rafId = requestAnimationFrame(animate);
    };

    const startOrStatic = () => {
      stopLoop();
      if (!immersive || motionQuery?.matches) {
        curYaw = cameraTargetRef.current.yaw;
        curPitch = cameraTargetRef.current.pitch;
        curZoom = cameraTargetRef.current.zoom;
        drawFrame(0);
        return;
      }
      startTime = 0;
      drawFrame(0);
      rafId = requestAnimationFrame(animate);
    };

    const onResize = () => {
      syncSize();
      if (!immersive || motionQuery?.matches) drawFrame(0);
    };

    syncSize();
    startOrStatic();

    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
    if (ro) ro.observe(canvas);
    else window.addEventListener("resize", onResize);
    motionQuery?.addEventListener?.("change", startOrStatic);

    return () => {
      disposed = true;
      stopLoop();
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
      motionQuery?.removeEventListener?.("change", startOrStatic);
      if (gl) {
        gl.deleteBuffer(quadBuf);
        gl.deleteBuffer(starBuf);
        gl.deleteProgram(skyProg);
        gl.deleteProgram(starProg);
      }
    };
  }, [starData, immersive]);

  // In "galaxy dark" mode the backdrop keeps its deep-space identity and never
  // fades out, whatever the global UI theme is.
  const washedOut = isLightTheme && !galaxyDark;

  return (
    <div
      aria-hidden="true"
      data-testid="aura-space-backdrop"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden select-none"
    >
      <div className={washedOut ? "absolute inset-0 opacity-60" : "absolute inset-0 opacity-20"}>
        <div
          className={`aura-galaxy-nebula absolute inset-0${
            galaxyDark ? " aura-galaxy-nebula-dark" : ""
          }`}
        />
      </div>
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full transition-opacity duration-500 ${
          washedOut ? "opacity-15" : "opacity-100"
        }`}
      />
    </div>
  );
}
