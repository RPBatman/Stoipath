# Prompt: upload slide test files from Downloads to a GitHub Release

Paste everything below the line into Claude Code on the laptop (Windows, PowerShell). It publishes the
files as assets of a **pre-release** on `RPBatman/Stoipath`, which the cloud session can download.
Release assets are used instead of git commits because slide files are large (up to 2 GiB each) and
must never enter the repository history.

---

Goal: publish whole-slide image test files from my Downloads folder as assets of a GitHub pre-release
named `samples-v1` on the public repository RPBatman/Stoipath, so a cloud agent can download them for
viewer format tests. Work in PowerShell on this Windows laptop. Do not commit anything to git and do not
push to any branch; use only GitHub Releases.

Safety rules, which outrank everything else here:
- The repository is public, so every uploaded file becomes public. Only upload files that came from the
  OpenSlide test data collection (https://openslide.cs.cmu.edu/download/openslide-testdata/) or another
  source I confirm is public and de-identified. Never upload anything that could contain patient
  information. If you are unsure where a file came from, leave it out and tell me.
- Never move, rename, modify or delete the originals in Downloads. Work on copies in a staging folder.
- Show me the final list of files, sizes and licences and wait for my "yes" before uploading anything.

Steps:
1. Tooling. Check that the GitHub CLI is installed (`gh --version`); if not, install it with
   `winget install --id GitHub.cli -e` and open a new shell. Check `gh auth status`; if I am not logged
   in, run `gh auth login` (GitHub.com, HTTPS, browser) and let me finish it.
2. Find candidates in `$env:USERPROFILE\Downloads` (top level and one folder deep): files with the
   extensions .svs .tif .tiff .ndpi .vms .vmu .scn .mrxs .bif .isyntax .i2syntax .czi .zvi .vsi .dcm
   .svslide .jp2 .zip, and folders that belong to multi-file formats (a .mrxs file's same-named data
   folder, a .vms/.vmu file with its .jpg/.ngr parts, a folder of DICOM .dcm files, a .vsi file's
   `_name_` folder). Ignore everything else in Downloads.
3. Identify each candidate. If https://openslide.cs.cmu.edu/download/openslide-testdata/index.json
   exists, download it and match each file by SHA-256 to get its OpenSlide path, description and
   licence; otherwise use the per-format folder pages of that site. Record for each file: name, format
   family, vendor, size, SHA-256 (`Get-FileHash -Algorithm SHA256`), the OpenSlide path or other
   source URL, and the licence text. Mark anything without a match as "source unknown" and exclude it.
4. Package into a new staging folder `$env:USERPROFILE\stoipath-samples-v1`:
   - single-file formats: copy as is;
   - multi-file formats (MRXS with its folder, VMS/VMU with parts, DICOM folders, VSI with its folder):
     zip each slide with its parts, keeping the folder structure, using
     `tar.exe -a -c -f <name>.zip <items>` (not Compress-Archive, which struggles with large files);
     keep an OpenSlide zip that is already zipped as is.
   GitHub rejects release assets of 2 GiB or more: list any such file as "too large, not uploaded"
   instead of splitting it.
5. Write `samples-manifest.json` and `samples-manifest.csv` in the staging folder with one row per
   uploaded asset: asset name, original file names inside it, format family, vendor, bytes, SHA-256 of
   the asset as uploaded, SHA-256 of each original, source URL or OpenSlide path, licence.
6. Show me the table (asset, format, size, licence, source) plus the excluded files and why. Wait for
   my "yes".
7. Create the release and upload:
   `gh release create samples-v1 --repo RPBatman/Stoipath --prerelease --title "Format test corpus v1" --notes "Public de-identified whole-slide test files (OpenSlide test data) for format tests. See samples-manifest.json for sources, licences and SHA-256."`
   then upload the manifests and every asset with
   `gh release upload samples-v1 <files> --repo RPBatman/Stoipath`, a few files per call so one
   failure does not lose the rest. If the release already exists, upload into it and use `--clobber`
   only for files whose checksum changed.
8. Verify with `gh release view samples-v1 --repo RPBatman/Stoipath --json assets` that every asset
   is present with the expected size. Report the release URL, the asset list with sizes, the excluded
   files and the total bytes uploaded, so I can paste the result to the cloud session.
