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
    ///
    /// Load On Enter (optional): the slot shows its fallback and downloads nothing until an
    /// UnderWebMediaRoom asks it to (when you walk into its room), and lets its textures go
    /// again a while after you leave. Slot IDs and addresses are unchanged either way.
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
        [Tooltip("Optional: other screens that show the same picture (same material index + texture property). No extra downloads.")]
        public Renderer[] alsoShowOn;

        [Header("Lazy loading (optional)")]
        [Tooltip("Download nothing on join: wait until an UnderWebMediaRoom says a player walked into this slot's room.")]
        public bool loadOnEnter = false;

        [Header("Baked by Tools → UnderWeb → Bake Media URLs (don't edit by hand)")]
        public VRCUrl[] urls;

        private VRCImageDownloader _downloader;
        private Texture2D[] _textures;
        private int[] _active;
        private int _activeCount;
        private int _showIndex;
        private bool _rotating;
        private Material _material;
        private Material[] _mirrors;
        private int _shownPos;       // 1-based position on screen right now, 0 = the fallback
        private string[] _ids;       // per position, from the manifest's optional "ids" (e.g. which creator's card it is)
        private int[] _likes;        // per position, from the manifest's optional "likes"
        private bool _started;
        private bool _wanted;      // loadOnEnter: true while the room wants us loaded
        private bool _restDone;    // loadOnEnter: images 2+ have been asked for
        private float _rotateDue;  // ignores a stale rotation tick left over from before a Release

        private void Start()
        {
            if (_started) return;
            _downloader = new VRCImageDownloader();
            _textures = new Texture2D[Mathf.Max(1, gallerySize)];
            if (targetRenderer != null)
            {
                Material[] mats = targetRenderer.materials; // instance materials, so other objects aren't affected
                if (materialIndex >= 0 && materialIndex < mats.Length) _material = mats[materialIndex];
            }
            if (alsoShowOn != null)
            {
                _mirrors = new Material[alsoShowOn.Length];
                for (int i = 0; i < alsoShowOn.Length; i++)
                {
                    if (alsoShowOn[i] == null) continue;
                    Material[] ms = alsoShowOn[i].materials;
                    if (materialIndex >= 0 && materialIndex < ms.Length) _mirrors[i] = ms[materialIndex];
                }
            }
            ApplyTexture(fallback);
            _started = true;
            // Until the manifest arrives, assume every baked position may be in use.
            if (_active == null) SetAllActive();
            if (!loadOnEnter) LoadActive();
        }

        private bool Live() { return !loadOnEnter || _wanted; }

        /// <summary>Load On Enter: download the first active image only (so every screen in a room shows something fast).</summary>
        public void LoadFirst()
        {
            if (!_started) Start();
            _wanted = true;
            if (urls == null || _downloader == null || _active == null || _activeCount == 0) return;
            int pos = _active[0];
            if (pos >= 1 && pos <= urls.Length && pos <= _textures.Length && _textures[pos - 1] == null && urls[pos - 1] != null)
                _downloader.DownloadImage(urls[pos - 1], null, (IUdonEventReceiver)this, null);
        }

        /// <summary>Load On Enter: download the rest of the gallery (call after every slot's LoadFirst).</summary>
        public void LoadRest()
        {
            if (!_started) Start();
            _wanted = true;
            if (_restDone || urls == null || _downloader == null || _active == null) return;
            _restDone = true;
            for (int i = 1; i < _activeCount; i++)
            {
                int pos = _active[i];
                if (pos < 1 || pos > urls.Length || pos > _textures.Length || urls[pos - 1] == null || _textures[pos - 1] != null) continue;
                _downloader.DownloadImage(urls[pos - 1], null, (IUdonEventReceiver)this, null);
            }
        }

        /// <summary>Load On Enter: everyone left the room a while ago - drop the downloaded textures, show the fallback.</summary>
        public void Release()
        {
            if (!loadOnEnter || !_started) return;
            _wanted = false; _restDone = false; _rotating = false; _showIndex = 0;
            ApplyTexture(fallback);
            if (_downloader != null) _downloader.Dispose();   // frees every texture it downloaded
            _downloader = new VRCImageDownloader();
            _textures = new Texture2D[Mathf.Max(1, gallerySize)];
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
            if (_started && Live()) LoadActive();
        }

        /// <summary>Called by UnderWebMediaWorld with the manifest's optional per-position "ids" and "likes" (index 0 = position 1).</summary>
        public void ApplyExtras(string[] ids, int[] likes)
        {
            _ids = ids;
            _likes = likes;
        }

        /// <summary>The 1-based position showing right now (0 = the fallback is showing).</summary>
        public int CurrentPosition() { return _shownPos; }
        /// <summary>The manifest id of what's showing right now ("" if none / the fallback).</summary>
        public string CurrentId()
        {
            if (_shownPos < 1 || _ids == null || _shownPos > _ids.Length || _ids[_shownPos - 1] == null) return "";
            return _ids[_shownPos - 1];
        }
        /// <summary>The manifest's like count for what's showing right now (0 if none).</summary>
        public int CurrentLikes()
        {
            if (_shownPos < 1 || _likes == null || _shownPos > _likes.Length) return 0;
            return _likes[_shownPos - 1];
        }

        /// <summary>Re-download everything that's active (the world calls this on its refresh timer).</summary>
        public void Refresh()
        {
            if (_started && Live()) LoadActive();
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
            if (!Live()) return;   // arrived after we were released
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
            _shownPos = tex != null ? _active[_showIndex % _activeCount] : 0;
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
                        _shownPos = pos;
                        break;
                    }
                }
            }
            ApplyTexture(tex != null ? tex : fallback);
        }

        private void StartRotation()
        {
            _rotating = true;
            float wait = Mathf.Max(3f, rotateSeconds);
            _rotateDue = Time.time + wait;
            SendCustomEventDelayedSeconds(nameof(_RotateTick), wait);
        }

        public void _RotateTick()
        {
            if (!_rotating || Time.time < _rotateDue - 0.5f) return;
            if (_activeCount <= 1 || !Live())
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
            if (tex == fallback || tex == null) _shownPos = 0;
            if (_material != null) _material.SetTexture(textureProperty, tex);
            if (_mirrors != null) for (int i = 0; i < _mirrors.Length; i++) if (_mirrors[i] != null) _mirrors[i].SetTexture(textureProperty, tex);
        }

        private void OnDestroy()
        {
            if (_downloader != null) _downloader.Dispose();
        }
    }
}
