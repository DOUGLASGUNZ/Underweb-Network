using UdonSharp;
using UnityEngine;
using VRC.SDK3.Image;
using VRC.SDKBase;
using VRC.Udon.Common.Interfaces;

namespace UnderWeb.Media
{
    /// <summary>
    /// One poster / frame / billboard / screen whose image is managed from underweb.cloud.
    /// Its image addresses are baked in the editor (Tools → UnderWeb → Bake Media URLs),
    /// because Udon can't build URLs at runtime. The website only ever replaces the file
    /// behind each address, so the world never needs re-uploading for a new poster.
    ///
    /// Single slot: shows image 1. Gallery: rotates through the images the website marks
    /// active in the manifest. Shows the fallback texture until a download succeeds or
    /// if it fails.
    /// </summary>
    [UdonBehaviourSyncMode(BehaviourSyncMode.None)]
    public class UnderWebMediaSlot : UdonSharpBehaviour
    {
        [Header("Set this to the Slot ID from the World Media Manager")]
        public string slotKey = "MAIN_ENTRANCE_01";
        [Tooltip("1 for a single poster. For a gallery, the number of images (max 20) — must match the website.")]
        [Range(1, 20)] public int gallerySize = 1;
        [Tooltip("Seconds per image for galleries. The website's value wins once the manifest loads.")]
        public float rotateSeconds = 12f;

        [Header("Where the image goes")]
        public Renderer targetRenderer;
        public int materialIndex = 0;
        public string textureProperty = "_MainTex";
        [Tooltip("Shown before the first download and whenever one fails.")]
        public Texture2D fallback;

        [Header("Baked by Tools → UnderWeb → Bake Media URLs (don't edit by hand)")]
        public VRCUrl[] urls;

        private VRCImageDownloader _downloader;
        private Texture2D[] _textures;
        private int[] _active;
        private int _activeCount;
        private int _showIndex;
        private bool _rotating;
        private Material _material;
        private bool _started;

        private void Start()
        {
            _downloader = new VRCImageDownloader();
            _textures = new Texture2D[Mathf.Max(1, gallerySize)];
            if (targetRenderer != null)
            {
                Material[] mats = targetRenderer.materials; // instance materials, so other objects aren't affected
                if (materialIndex >= 0 && materialIndex < mats.Length) _material = mats[materialIndex];
            }
            ApplyTexture(fallback);
            _started = true;
            // Until the manifest arrives, assume every baked position may be in use.
            if (_active == null) SetAllActive();
            LoadActive();
        }

        private void SetAllActive()
        {
            int n = urls == null ? 0 : urls.Length;
            _active = new int[n];
            for (int i = 0; i < n; i++) _active[i] = i + 1;
            _activeCount = n;
        }

        /// <summary>Called by UnderWebMediaWorld when the manifest loads. positions are 1-based.</summary>
        public void ApplyManifest(int[] positions, int count, float rotate)
        {
            _active = positions;
            _activeCount = count;
            if (rotate >= 3f) rotateSeconds = rotate;
            if (_activeCount == 0)
            {
                ApplyTexture(fallback);
                return;
            }
            if (_started) LoadActive();
        }

        /// <summary>Re-download everything that's active (the world calls this on its refresh timer).</summary>
        public void Refresh()
        {
            if (_started) LoadActive();
        }

        private void LoadActive()
        {
            if (urls == null || _downloader == null) return;
            for (int i = 0; i < _activeCount; i++)
            {
                int pos = _active[i];
                if (pos < 1 || pos > urls.Length || urls[pos - 1] == null) continue;
                // VRChat queues downloads world-wide (one every 5 seconds), so asking for
                // several at once is fine; they arrive in turn.
                _downloader.DownloadImage(urls[pos - 1], null, (IUdonEventReceiver)this, null);
            }
        }

        public override void OnImageLoadSuccess(IVRCImageDownload result)
        {
            int pos = PositionOf(result.Url);
            if (pos < 1) return;
            _textures[pos - 1] = result.Result;
            ShowCurrent();
            if (gallerySize > 1 && _activeCount > 1 && !_rotating) StartRotation();
        }

        public override void OnImageLoadError(IVRCImageDownload result)
        {
            Debug.LogWarning($"[UnderWebMedia] {slotKey}: couldn't load {result.Url} ({result.Error}: {result.ErrorMessage})");
            if (CurrentTexture() == null) ApplyTexture(fallback);
        }

        private int PositionOf(VRCUrl url)
        {
            if (urls == null || url == null) return -1;
            string s = url.Get();
            for (int i = 0; i < urls.Length; i++)
            {
                if (urls[i] != null && urls[i].Get() == s) return i + 1;
            }
            return -1;
        }

        private Texture2D CurrentTexture()
        {
            if (_activeCount == 0 || _active == null) return null;
            int pos = _active[_showIndex % _activeCount];
            return pos >= 1 && pos <= _textures.Length ? _textures[pos - 1] : null;
        }

        private void ShowCurrent()
        {
            Texture2D tex = CurrentTexture();
            if (tex == null)
            {
                // Show the first image that has arrived instead of nothing.
                for (int i = 0; i < _activeCount; i++)
                {
                    int pos = _active[i];
                    if (pos >= 1 && pos <= _textures.Length && _textures[pos - 1] != null)
                    {
                        _showIndex = i;
                        tex = _textures[pos - 1];
                        break;
                    }
                }
            }
            ApplyTexture(tex != null ? tex : fallback);
        }

        private void StartRotation()
        {
            _rotating = true;
            SendCustomEventDelayedSeconds(nameof(_RotateTick), Mathf.Max(3f, rotateSeconds));
        }

        public void _RotateTick()
        {
            if (_activeCount <= 1)
            {
                _rotating = false;
                return;
            }
            for (int step = 0; step < _activeCount; step++)
            {
                _showIndex = (_showIndex + 1) % _activeCount;
                if (CurrentTexture() != null) break;
            }
            ShowCurrent();
            StartRotation();
        }

        private void ApplyTexture(Texture tex)
        {
            if (_material == null) return;
            _material.SetTexture(textureProperty, tex);
        }

        private void OnDestroy()
        {
            if (_downloader != null) _downloader.Dispose();
        }
    }
}
