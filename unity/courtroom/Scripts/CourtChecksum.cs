// UnderWeb Court: SHA-256 in UdonSharp, for the result checksum.
// Must match sha256Hex(canonicalJson(payload)) in supabase/functions/court/logic.ts.
// Input is ASCII only (the bench replaces other characters before hashing).
// FICTIONAL ROLEPLAY ONLY. NOT COMPILED OR TESTED IN UNITY YET. Test with a known vector before use.

using UdonSharp;
using UnityEngine;

public class CourtChecksum : UdonSharpBehaviour
{
    uint[] K;

    void Start()
    {
        K = new uint[64] {
            0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
            0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
            0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
            0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
            0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
            0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
            0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
        };
    }

    public string Sha256Hex(string ascii)
    {
        if (K == null) Start();
        int len = ascii.Length;
        int padded = ((len + 9 + 63) / 64) * 64;
        byte[] m = new byte[padded];
        for (int i = 0; i < len; i++) m[i] = (byte)ascii[i];
        m[len] = 0x80;
        uint bitsLo = (uint)(len * 8);
        m[padded - 4] = (byte)(bitsLo >> 24);
        m[padded - 3] = (byte)(bitsLo >> 16);
        m[padded - 2] = (byte)(bitsLo >> 8);
        m[padded - 1] = (byte)bitsLo;

        uint[] H = new uint[8] { 0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19 };
        uint[] w = new uint[64];

        for (int off = 0; off < padded; off += 64)
        {
            for (int t = 0; t < 16; t++)
            {
                int j = off + t * 4;
                w[t] = ((uint)m[j] << 24) | ((uint)m[j + 1] << 16) | ((uint)m[j + 2] << 8) | (uint)m[j + 3];
            }
            for (int t = 16; t < 64; t++)
            {
                uint s0 = Rotr(w[t - 15], 7) ^ Rotr(w[t - 15], 18) ^ (w[t - 15] >> 3);
                uint s1 = Rotr(w[t - 2], 17) ^ Rotr(w[t - 2], 19) ^ (w[t - 2] >> 10);
                w[t] = w[t - 16] + s0 + w[t - 7] + s1;
            }

            uint a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
            for (int t = 0; t < 64; t++)
            {
                uint S1 = Rotr(e, 6) ^ Rotr(e, 11) ^ Rotr(e, 25);
                uint ch = (e & f) ^ (~e & g);
                uint temp1 = h + S1 + ch + K[t] + w[t];
                uint S0 = Rotr(a, 2) ^ Rotr(a, 13) ^ Rotr(a, 22);
                uint maj = (a & b) ^ (a & c) ^ (b & c);
                uint temp2 = S0 + maj;
                h = g; g = f; f = e; e = d + temp1;
                d = c; c = b; b = a; a = temp1 + temp2;
            }
            H[0] += a; H[1] += b; H[2] += c; H[3] += d;
            H[4] += e; H[5] += f; H[6] += g; H[7] += h;
        }

        string hex = "0123456789abcdef";
        char[] outChars = new char[64];
        for (int i = 0; i < 8; i++)
        {
            for (int n = 0; n < 8; n++)
            {
                int shift = 28 - n * 4;
                outChars[i * 8 + n] = hex[(int)((H[i] >> shift) & 0xF)];
            }
        }
        return new string(outChars);
    }

    uint Rotr(uint x, int n)
    {
        return (x >> n) | (x << (32 - n));
    }
}
