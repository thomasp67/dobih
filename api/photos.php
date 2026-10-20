<?php
/**
 * DoBIH Photos API
 * Handles file queue retrieval, live photos, archiving, metadata updates, and cropping operations.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$baseDir = dirname(__DIR__);
$stagingDir = $baseDir . DIRECTORY_SEPARATOR . 'image' . DIRECTORY_SEPARATOR . 'staging';
$archiveDir = $stagingDir . DIRECTORY_SEPARATOR . 'archive';
$hillsDir = $baseDir . DIRECTORY_SEPARATOR . 'image' . DIRECTORY_SEPARATOR . 'hills';
$psScript = $hillsDir . DIRECTORY_SEPARATOR . 'process_crop.ps1';

// Ensure staging and archive directories exist
if (!is_dir($stagingDir)) {
    @mkdir($stagingDir, 0777, true);
}
if (!is_dir($archiveDir)) {
    @mkdir($archiveDir, 0777, true);
}

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'queue':
        handleQueue($stagingDir, $hillsDir, $archiveDir);
        break;

    case 'live_list':
    case 'live':
        handleLiveList($hillsDir, $archiveDir, $stagingDir);
        break;

    case 'archive_list':
    case 'archive':
        handleArchiveList($archiveDir, $hillsDir, $stagingDir);
        break;

    case 'archive_single':
        handleArchiveSingle($stagingDir, $archiveDir);
        break;

    case 'send_to_staging':
        handleSendToStaging($archiveDir, $stagingDir);
        break;

    case 'delete_live':
        handleDeleteLive($hillsDir);
        break;

    case 'update_live_meta':
        handleUpdateLiveMeta($hillsDir);
        break;

    case 'next_index':
        handleNextIndex($hillsDir);
        break;

    case 'process':
        handleProcess($stagingDir, $hillsDir, $archiveDir, $psScript);
        break;

    case 'delete':
    case 'delete_staging':
        handleDeleteStaging($stagingDir);
        break;

    case 'delete_archive':
        handleDeleteArchive($archiveDir);
        break;

    default:
        echo json_encode([
            'success' => false,
            'error' => 'Invalid action. Supported: queue, live_list, archive_list, archive_single, send_to_staging, update_live_meta, delete_live, delete_archive, delete_staging, process, next_index.'
        ]);
        break;
}

/**
 * Counts photos across staging, live, and archive.
 */
function getAreaStats(string $stagingDir, string $hillsDir, string $archiveDir): array {
    $stagingCount = 0;
    if (is_dir($stagingDir)) {
        foreach (scandir($stagingDir) as $f) {
            if ($f === '.' || $f === '..' || $f === 'archive') continue;
            if (is_file($stagingDir . DIRECTORY_SEPARATOR . $f) && preg_match('/\.(jpe?g|png|webp)$/i', $f)) {
                $stagingCount++;
            }
        }
    }

    $archiveCount = 0;
    if (is_dir($archiveDir)) {
        foreach (scandir($archiveDir) as $f) {
            if ($f === '.' || $f === '..') continue;
            if (is_file($archiveDir . DIRECTORY_SEPARATOR . $f) && preg_match('/\.(jpe?g|png|webp)$/i', $f)) {
                $archiveCount++;
            }
        }
    }

    $liveCount = 0;
    if (is_dir($hillsDir)) {
        foreach (scandir($hillsDir) as $f) {
            if ($f === '.' || $f === '..') continue;
            if (is_file($hillsDir . DIRECTORY_SEPARATOR . $f) && preg_match('/\.(jpe?g|png|webp)$/i', $f)) {
                $liveCount++;
            }
        }
    }

    return [
        'staging' => $stagingCount,
        'live' => $liveCount,
        'archived' => $archiveCount
    ];
}

/**
 * Lists all pending photos in the staging folder and checks for already processed & archived CRC32 matches.
 */
function handleQueue(string $stagingDir, string $hillsDir, string $archiveDir): void {
    if (!is_dir($stagingDir)) {
        echo json_encode(['success' => true, 'queue' => [], 'count' => 0, 'stats' => getAreaStats($stagingDir, $hillsDir, $archiveDir)]);
        return;
    }

    // Build map of already processed CRC32 values from image/hills
    $processedCrcs = getProcessedCrcMap($hillsDir);

    // Build map of already archived files from image/staging/archive
    $archivedMap = getArchivedCrcMap($archiveDir);

    $rawFiles = scandir($stagingDir);
    $queue = [];
    $addedCount = 0;
    $archivedCount = 0;

    foreach ($rawFiles as $file) {
        if ($file === '.' || $file === '..' || $file === 'archive') continue;
        $fullPath = $stagingDir . DIRECTORY_SEPARATOR . $file;
        if (!is_file($fullPath)) continue;

        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        if (!in_array($ext, ['jpg', 'jpeg', 'png', 'webp'])) continue;

        $sizeBytes = filesize($fullPath);
        $sizeFormatted = $sizeBytes >= 1048576 
            ? round($sizeBytes / 1048576, 2) . ' MB' 
            : round($sizeBytes / 1024, 1) . ' KB';

        // Parse filename: datetaken_timetaken_crc32 area where the photo was taken.jpg
        $parsed = parsePhotoFilename($file);

        // Check if this CRC32 was already processed into the site
        $crcKey = !empty($parsed['crc']) ? strtolower($parsed['crc']) : '';
        $alreadyProcessed = false;
        $processedInfo = null;

        if ($crcKey !== '' && isset($processedCrcs[$crcKey])) {
            $alreadyProcessed = true;
            $processedInfo = $processedCrcs[$crcKey];
            $addedCount++;
        }

        // Check if this photo (by CRC32 or filename) is already in the archive
        $isArchived = false;
        $archiveInfo = null;

        if ($crcKey !== '' && isset($archivedMap['crc'][$crcKey])) {
            $isArchived = true;
            $archiveInfo = $archivedMap['crc'][$crcKey];
            $archivedCount++;
        } elseif (isset($archivedMap['filenames'][strtolower($file)])) {
            $isArchived = true;
            $archiveInfo = $archivedMap['filenames'][strtolower($file)];
            $archivedCount++;
        }

        $queue[] = [
            'filename' => $file,
            'url' => 'image/staging/' . rawurlencode($file),
            'sizeBytes' => $sizeBytes,
            'sizeFormatted' => $sizeFormatted,
            'mtime' => filemtime($fullPath),
            'parsed' => $parsed,
            'alreadyProcessed' => $alreadyProcessed,
            'processedInfo' => $processedInfo,
            'isArchived' => $isArchived,
            'archiveInfo' => $archiveInfo
        ];
    }

    // Sort queue by filename
    usort($queue, function ($a, $b) {
        return strcmp($a['filename'], $b['filename']);
    });

    $stats = getAreaStats($stagingDir, $hillsDir, $archiveDir);
    $stats['total'] = count($queue);
    $stats['added'] = $addedCount;

    echo json_encode([
        'success' => true,
        'queue' => $queue,
        'count' => count($queue),
        'stats' => $stats
    ]);
}

/**
 * Lists all live photos published in image/hills, cross-referencing photos.json and archive original by CRC32.
 */
function handleLiveList(string $hillsDir, string $archiveDir, string $stagingDir): void {
    if (!is_dir($hillsDir)) {
        echo json_encode(['success' => true, 'live' => [], 'count' => 0, 'stats' => getAreaStats($stagingDir, $hillsDir, $archiveDir)]);
        return;
    }

    // Load photos.json manifest
    $jsonPath = $hillsDir . DIRECTORY_SEPARATOR . 'photos.json';
    $manifest = [];
    if (file_exists($jsonPath)) {
        $raw = @file_get_contents($jsonPath);
        $manifest = @json_decode($raw, true) ?: [];
    }

    // Index manifest by file
    $fileHills = [];
    foreach ($manifest as $hid => $entries) {
        if (!is_array($entries)) continue;
        $hidInt = (int)$hid;
        foreach ($entries as $e) {
            $fn = $e['file'] ?? '';
            if ($fn === '') continue;
            if (!isset($fileHills[$fn])) {
                $fileHills[$fn] = [
                    'primary' => [],
                    'secondary' => [],
                    'from' => [],
                    'allHills' => [],
                    'comment' => $e['title'] ?? ''
                ];
            }
            $role = strtolower($e['role'] ?? 'primary');
            if ($role === 'from') {
                if (!in_array($hidInt, $fileHills[$fn]['from'])) $fileHills[$fn]['from'][] = $hidInt;
            } elseif ($role === 'secondary') {
                if (!in_array($hidInt, $fileHills[$fn]['secondary'])) $fileHills[$fn]['secondary'][] = $hidInt;
            } else {
                if (!in_array($hidInt, $fileHills[$fn]['primary'])) $fileHills[$fn]['primary'][] = $hidInt;
            }
            if (!in_array($hidInt, $fileHills[$fn]['allHills'])) $fileHills[$fn]['allHills'][] = $hidInt;
            if (empty($fileHills[$fn]['comment']) && !empty($e['title'])) {
                $fileHills[$fn]['comment'] = $e['title'];
            }
        }
    }

    // Build archived lookup map by CRC32
    $archivedMap = getArchivedCrcMap($archiveDir);

    $files = scandir($hillsDir);
    $live = [];

    foreach ($files as $f) {
        if ($f === '.' || $f === '..') continue;
        $fullPath = $hillsDir . DIRECTORY_SEPARATOR . $f;
        if (!is_file($fullPath)) continue;

        $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
        if (!in_array($ext, ['jpg', 'jpeg', 'png', 'webp'])) continue;

        $sizeBytes = filesize($fullPath);
        $sizeFormatted = $sizeBytes >= 1048576 
            ? round($sizeBytes / 1048576, 2) . ' MB' 
            : round($sizeBytes / 1024, 1) . ' KB';

        // Extract CRC32
        $crc = null;
        if (preg_match('/^([a-fA-F0-9]{4,16})\./', $f, $m)) {
            $crc = strtolower($m[1]);
        } else {
            $parsed = parsePhotoFilename($f, $fullPath);
            $crc = $parsed['crc'];
        }

        $meta = $fileHills[$f] ?? [
            'primary' => [],
            'secondary' => [],
            'from' => [],
            'allHills' => [],
            'comment' => ''
        ];

        // Match against archive original by CRC32
        $hasArchive = false;
        $archiveInfo = null;
        if ($crc && isset($archivedMap['crc'][$crc])) {
            $hasArchive = true;
            $archiveInfo = $archivedMap['crc'][$crc];
        }

        $live[] = [
            'file' => $f,
            'url' => 'image/hills/' . rawurlencode($f),
            'crc' => $crc,
            'sizeBytes' => $sizeBytes,
            'sizeFormatted' => $sizeFormatted,
            'mtime' => filemtime($fullPath),
            'comment' => $meta['comment'],
            'primary' => $meta['primary'],
            'secondary' => $meta['secondary'],
            'from' => $meta['from'],
            'allHills' => $meta['allHills'],
            'hasArchive' => $hasArchive,
            'archiveInfo' => $archiveInfo
        ];
    }

    // Sort live by newest mtime first
    usort($live, function ($a, $b) {
        return $b['mtime'] <=> $a['mtime'];
    });

    echo json_encode([
        'success' => true,
        'live' => $live,
        'count' => count($live),
        'stats' => getAreaStats($stagingDir, $hillsDir, $archiveDir)
    ]);
}

/**
 * Lists all archived photos, cross-referencing live site status by CRC32.
 */
function handleArchiveList(string $archiveDir, string $hillsDir, string $stagingDir): void {
    if (!is_dir($archiveDir)) {
        echo json_encode([
            'success' => true,
            'archive' => [],
            'count' => 0,
            'liveCount' => 0,
            'archivedOnlyCount' => 0,
            'stats' => getAreaStats($stagingDir, $hillsDir, $archiveDir)
        ]);
        return;
    }

    // Map of live site files by CRC32
    $processedMap = getProcessedCrcMap($hillsDir);

    $files = scandir($archiveDir);
    $list = [];
    $liveCount = 0;
    $archivedOnlyCount = 0;

    foreach ($files as $f) {
        if ($f === '.' || $f === '..') continue;
        $path = $archiveDir . DIRECTORY_SEPARATOR . $f;
        if (!is_file($path)) continue;

        $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
        if (!in_array($ext, ['jpg', 'jpeg', 'png', 'webp'])) continue;

        $sizeBytes = filesize($path);
        $sizeFormatted = $sizeBytes >= 1048576 
            ? round($sizeBytes / 1048576, 2) . ' MB' 
            : round($sizeBytes / 1024, 1) . ' KB';

        $parsed = parsePhotoFilename($f, $path);
        $crc = $parsed['crc'];

        $isLive = false;
        $liveInfo = null;
        if ($crc && isset($processedMap[$crc])) {
            $isLive = true;
            $liveInfo = $processedMap[$crc];
            $liveCount++;
        } else {
            $archivedOnlyCount++;
        }

        $list[] = [
            'filename' => $f,
            'url' => 'image/staging/archive/' . rawurlencode($f),
            'sizeBytes' => $sizeBytes,
            'sizeFormatted' => $sizeFormatted,
            'mtime' => filemtime($path),
            'parsed' => $parsed,
            'crc' => $crc,
            'isLive' => $isLive,
            'liveInfo' => $liveInfo
        ];
    }

    // Sort by mtime descending
    usort($list, function ($a, $b) {
        return $b['mtime'] <=> $a['mtime'];
    });

    echo json_encode([
        'success' => true,
        'archive' => $list,
        'count' => count($list),
        'liveCount' => $liveCount,
        'archivedOnlyCount' => $archivedOnlyCount,
        'stats' => getAreaStats($stagingDir, $hillsDir, $archiveDir)
    ]);
}

/**
 * Simply archives a photo from staging without processing (for photos deemed not needed on site).
 */
function handleArchiveSingle(string $stagingDir, string $archiveDir): void {
    $rawInput = file_get_contents('php://input');
    $data = json_decode($rawInput, true);
    $filename = trim($data['filename'] ?? $_POST['filename'] ?? '');

    if ($filename === '') {
        echo json_encode(['success' => false, 'error' => 'Missing filename to archive.']);
        return;
    }

    $sourcePath = $stagingDir . DIRECTORY_SEPARATOR . $filename;
    if (!file_exists($sourcePath)) {
        echo json_encode(['success' => false, 'error' => 'Source photo not found in staging.']);
        return;
    }

    if (!is_dir($archiveDir)) {
        @mkdir($archiveDir, 0777, true);
    }

    $destPath = $archiveDir . DIRECTORY_SEPARATOR . $filename;
    if (file_exists($destPath)) {
        // If exact destination exists, move with overwrite
        @unlink($destPath);
    }

    $ok = @rename($sourcePath, $destPath);
    if (!$ok) {
        $ok = @copy($sourcePath, $destPath);
        if ($ok) @unlink($sourcePath);
    }

    if ($ok) {
        echo json_encode([
            'success' => true,
            'message' => 'Photo moved to archive.',
            'filename' => $filename,
            'archivedTo' => 'image/staging/archive/' . $filename
        ]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Failed to move photo to archive folder.']);
    }
}

/**
 * Sends/copies an archived photo back to staging so it can be cropped or re-curated.
 */
function handleSendToStaging(string $archiveDir, string $stagingDir): void {
    $rawInput = file_get_contents('php://input');
    $data = json_decode($rawInput, true);
    $filename = trim($data['filename'] ?? $_POST['filename'] ?? '');
    $move = !empty($data['move']); // if true, moves instead of copies

    if ($filename === '') {
        echo json_encode(['success' => false, 'error' => 'Missing filename.']);
        return;
    }

    $sourcePath = $archiveDir . DIRECTORY_SEPARATOR . $filename;
    if (!file_exists($sourcePath)) {
        echo json_encode(['success' => false, 'error' => 'Archived photo not found.']);
        return;
    }

    $destPath = $stagingDir . DIRECTORY_SEPARATOR . $filename;
    $ok = false;
    if ($move) {
        $ok = @rename($sourcePath, $destPath);
    } else {
        $ok = @copy($sourcePath, $destPath);
    }

    if ($ok) {
        echo json_encode([
            'success' => true,
            'message' => 'Photo added to staging queue.',
            'filename' => $filename
        ]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Failed to copy photo to staging.']);
    }
}

/**
 * Updates primary, secondary, from hills and caption for a live photo in photos.json.
 */
function handleUpdateLiveMeta(string $hillsDir): void {
    $rawInput = file_get_contents('php://input');
    $data = json_decode($rawInput, true);
    $targetFile = trim($data['filename'] ?? '');
    $comment = trim($data['comment'] ?? '');

    if ($targetFile === '') {
        echo json_encode(['success' => false, 'error' => 'Missing filename to update.']);
        return;
    }

    $rawPrimary = is_array($data['primaryHills'] ?? null) ? $data['primaryHills'] : [];
    $rawSecondary = is_array($data['secondaryHills'] ?? null) ? $data['secondaryHills'] : [];
    $rawFrom = is_array($data['fromHills'] ?? null) ? $data['fromHills'] : [];

    $cleanPrimary = array_values(array_unique(array_filter(array_map('trim', $rawPrimary), fn($v) => preg_match('/^\d+$/', $v))));
    $cleanSecondary = array_values(array_unique(array_filter(array_map('trim', $rawSecondary), fn($v) => preg_match('/^\d+$/', $v))));
    $cleanFrom = array_values(array_unique(array_filter(array_map('trim', $rawFrom), fn($v) => preg_match('/^\d+$/', $v))));

    if (empty($cleanPrimary) && empty($cleanFrom)) {
        echo json_encode(['success' => false, 'error' => 'At least one hill must be in Primary or Taken From.']);
        return;
    }

    $jsonPath = $hillsDir . DIRECTORY_SEPARATOR . 'photos.json';
    $dict = [];
    if (file_exists($jsonPath)) {
        $raw = @file_get_contents($jsonPath);
        $dict = @json_decode($raw, true) ?: [];
    }

    // Remove old references for this file across all hills
    foreach ($dict as $k => $entries) {
        if (!is_array($entries)) continue;
        $filtered = array_values(array_filter($entries, fn($e) => ($e['file'] ?? '') !== $targetFile));
        if (empty($filtered)) {
            unset($dict[$k]);
        } else {
            $dict[$k] = $filtered;
        }
    }

    // Add Primary Hills
    foreach ($cleanPrimary as $hid) {
        if (!isset($dict[$hid])) $dict[$hid] = [];
        $dict[$hid][] = [
            'file' => $targetFile,
            'title' => $comment,
            'role' => 'primary'
        ];
    }

    // Add Secondary Hills
    foreach ($cleanSecondary as $hid) {
        if (!isset($dict[$hid])) $dict[$hid] = [];
        $dict[$hid][] = [
            'file' => $targetFile,
            'title' => $comment,
            'role' => 'secondary'
        ];
    }

    // Add Taken From Hills
    foreach ($cleanFrom as $hid) {
        if (!isset($dict[$hid])) $dict[$hid] = [];
        $dict[$hid][] = [
            'file' => $targetFile,
            'title' => $comment,
            'role' => 'from'
        ];
    }

    // Sort manifest keys numerically
    uksort($dict, fn($a, $b) => (int)$a <=> (int)$b);

    // Sort entries for each hill by role: primary(0) > secondary(1) > from(2)
    foreach ($dict as $k => &$entries) {
        usort($entries, function ($a, $b) {
            $prio = ['primary' => 0, 'secondary' => 1, 'from' => 2];
            $pa = $prio[strtolower($a['role'] ?? 'primary')] ?? 3;
            $pb = $prio[strtolower($b['role'] ?? 'primary')] ?? 3;
            if ($pa !== $pb) return $pa <=> $pb;
            return strcmp($a['file'] ?? '', $b['file'] ?? '');
        });
    }
    unset($entries);

    $saved = @file_put_contents($jsonPath, json_encode($dict, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    if ($saved !== false) {
        echo json_encode([
            'success' => true,
            'message' => 'Metadata updated successfully.',
            'filename' => $targetFile,
            'primary' => $cleanPrimary,
            'secondary' => $cleanSecondary,
            'from' => $cleanFrom,
            'comment' => $comment
        ]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Failed to save photos.json.']);
    }
}

/**
 * Removes a photo from live site (image/hills and photos.json), preserving archive copy.
 */
function handleDeleteLive(string $hillsDir): void {
    $rawInput = file_get_contents('php://input');
    $data = json_decode($rawInput, true);
    $filename = trim($data['filename'] ?? $_POST['filename'] ?? '');

    if ($filename === '') {
        echo json_encode(['success' => false, 'error' => 'Missing filename to delete.']);
        return;
    }

    // 1. Remove file from image/hills
    $liveFilePath = $hillsDir . DIRECTORY_SEPARATOR . $filename;
    if (file_exists($liveFilePath)) {
        @unlink($liveFilePath);
    }

    // 2. Remove references from photos.json
    $jsonPath = $hillsDir . DIRECTORY_SEPARATOR . 'photos.json';
    if (file_exists($jsonPath)) {
        $raw = @file_get_contents($jsonPath);
        $dict = @json_decode($raw, true);
        if (is_array($dict)) {
            foreach ($dict as $k => $entries) {
                if (!is_array($entries)) continue;
                $filtered = array_values(array_filter($entries, fn($e) => ($e['file'] ?? '') !== $filename));
                if (empty($filtered)) {
                    unset($dict[$k]);
                } else {
                    $dict[$k] = $filtered;
                }
            }
            uksort($dict, fn($a, $b) => (int)$a <=> (int)$b);
            @file_put_contents($jsonPath, json_encode($dict, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        }
    }

    echo json_encode([
        'success' => true,
        'message' => 'Live photo removed from website. Original preserved in archive.',
        'filename' => $filename
    ]);
}

/**
 * Builds an index of all CRC32 checksums found in image/hills filenames and photos.json.
 */
function getProcessedCrcMap(string $hillsDir): array {
    $map = [];
    if (!is_dir($hillsDir)) return $map;

    // 1. Scan image/hills for photos (supports original filenames, <crc32>.jpg, and legacy <hillId>_<index>_<crc32>.jpg)
    $files = scandir($hillsDir);
    foreach ($files as $f) {
        if ($f === '.' || $f === '..') continue;
        $fullPath = $hillsDir . DIRECTORY_SEPARATOR . $f;
        if (!is_file($fullPath)) continue;

        $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
        if (!in_array($ext, ['jpg', 'jpeg', 'png', 'webp'])) continue;

        $crc = null;
        $primary = [];

        // Match <crc32>.jpg (e.g. 4cd9e263.jpg)
        if (preg_match('/^([a-fA-F0-9]{4,16})\.(?:jpg|jpeg|png|webp)$/i', $f, $m)) {
            $crc = strtolower($m[1]);
        }
        // Match legacy <hillId>_<index>_<crc32>.jpg (e.g. 79_003_4cd9e263.jpg)
        elseif (preg_match('/^(\d+)_(\d+)_([a-fA-F0-9]{4,16})\.(?:jpg|jpeg|png|webp)$/i', $f, $m)) {
            $crc = strtolower($m[3]);
            $primary = [(int)$m[1]];
        }
        // Original trip filename (e.g. 20081206_135709_f4e65091 loch lomond, arrochar.jpg)
        else {
            $parsed = parsePhotoFilename($f, $fullPath);
            if (!empty($parsed['crc'])) {
                $crc = strtolower($parsed['crc']);
            }
        }

        if ($crc) {
            if (!isset($map[$crc])) {
                $map[$crc] = [
                    'file' => $f,
                    'primary' => $primary,
                    'secondary' => [],
                    'from' => [],
                    'allHills' => $primary,
                    'comment' => ''
                ];
            }
        }
    }

    // 2. Cross-reference photos.json to attach categorized hill IDs and comment
    $jsonPath = $hillsDir . DIRECTORY_SEPARATOR . 'photos.json';
    if (file_exists($jsonPath)) {
        $raw = file_get_contents($jsonPath);
        $dict = @json_decode($raw, true);
        if (is_array($dict)) {
            foreach ($dict as $hid => $entries) {
                if (!is_array($entries)) continue;
                $hidInt = (int)$hid;
                foreach ($entries as $e) {
                    $fn = $e['file'] ?? '';
                    $crc = null;
                    if (preg_match('/^([a-fA-F0-9]{4,16})\.(?:jpg|jpeg|png|webp)$/i', $fn, $cm)) {
                        $crc = strtolower($cm[1]);
                    } elseif (preg_match('/^(?:\d+_\d+_)?([a-fA-F0-9]{4,16})\.(?:jpg|jpeg|png|webp)$/i', $fn, $cm)) {
                        $crc = strtolower($cm[1]);
                    } else {
                        $parsedFn = parsePhotoFilename($fn);
                        if (!empty($parsedFn['crc'])) {
                            $crc = strtolower($parsedFn['crc']);
                        }
                    }

                    if ($crc) {
                        if (!isset($map[$crc])) {
                            $map[$crc] = [
                                'file' => $fn,
                                'primary' => [],
                                'secondary' => [],
                                'from' => [],
                                'allHills' => [],
                                'comment' => $e['title'] ?? ''
                            ];
                        }
                        $role = strtolower($e['role'] ?? 'primary');
                        if ($role === 'from') {
                            if (!in_array($hidInt, $map[$crc]['from'])) $map[$crc]['from'][] = $hidInt;
                        } elseif ($role === 'secondary') {
                            if (!in_array($hidInt, $map[$crc]['secondary'])) $map[$crc]['secondary'][] = $hidInt;
                        } else {
                            if (!in_array($hidInt, $map[$crc]['primary'])) $map[$crc]['primary'][] = $hidInt;
                        }
                        if (!in_array($hidInt, $map[$crc]['allHills'])) $map[$crc]['allHills'][] = $hidInt;
                        if (empty($map[$crc]['comment']) && !empty($e['title'])) {
                            $map[$crc]['comment'] = $e['title'];
                        }
                    }
                }
            }
        }
    }

    return $map;
}

/**
 * Builds an index of all files in image/staging/archive/ indexed by CRC32 and filename.
 */
function getArchivedCrcMap(string $archiveDir): array {
    $map = [
        'crc' => [],
        'filenames' => []
    ];
    if (!is_dir($archiveDir)) return $map;

    $files = scandir($archiveDir);
    foreach ($files as $f) {
        if ($f === '.' || $f === '..') continue;
        $fullPath = $archiveDir . DIRECTORY_SEPARATOR . $f;
        if (!is_file($fullPath)) continue;

        $size = filesize($fullPath);
        $sizeFormatted = $size >= 1048576 
            ? round($size / 1048576, 2) . ' MB' 
            : round($size / 1024, 1) . ' KB';

        $parsed = parsePhotoFilename($f, $fullPath);
        $fileInfo = [
            'filename' => $f,
            'url' => 'image/staging/archive/' . rawurlencode($f),
            'size' => $size,
            'sizeFormatted' => $sizeFormatted,
            'mtime' => filemtime($fullPath),
            'dateFormatted' => $parsed['dateFormatted'] ?? null,
            'timeFormatted' => $parsed['timeFormatted'] ?? null,
            'areaHint' => $parsed['areaHint'] ?? '',
            'crc' => $parsed['crc'] ?? null
        ];

        $map['filenames'][strtolower($f)] = $fileInfo;

        if (!empty($parsed['crc'])) {
            $map['crc'][strtolower($parsed['crc'])] = $fileInfo;
        }
    }
    return $map;
}

/**
 * Calculates target filename (preserving original filename) and reports existing site status.
 */
function handleNextIndex(string $hillsDir): void {
    $crc = strtolower(trim($_GET['crc'] ?? ''));
    $filename = trim($_GET['filename'] ?? '');

    if ($filename !== '') {
        $baseName = pathinfo($filename, PATHINFO_FILENAME);
        $targetFile = $baseName . '.jpg';
    } elseif ($crc !== '' && preg_match('/^[a-fA-F0-9]{4,16}$/', $crc)) {
        $targetFile = $crc . '.jpg';
    } else {
        $targetFile = '';
    }

    $processedMap = getProcessedCrcMap($hillsDir);
    $existing = ($crc !== '' && isset($processedMap[$crc])) ? $processedMap[$crc] : null;

    echo json_encode([
        'success' => true,
        'crc' => $crc,
        'nextFile' => $targetFile,
        'alreadyExists' => ($existing !== null),
        'existingInfo' => $existing
    ]);
}

/**
 * Dispatches crop, resize, EXIF writing, archiving, and photos.json registration.
 */
function handleProcess(string $stagingDir, string $hillsDir, string $archiveDir, string $psScript): void {
    $rawInput = file_get_contents('php://input');
    $data = json_decode($rawInput, true);

    if (!$data) {
        echo json_encode(['success' => false, 'error' => 'Invalid JSON payload.']);
        return;
    }

    $filename = trim($data['filename'] ?? '');
    $comment = trim($data['comment'] ?? '');
    $crop = $data['crop'] ?? [];

    if ($filename === '') {
        echo json_encode(['success' => false, 'error' => 'Missing filename parameter.']);
        return;
    }

    $stagingFile = $stagingDir . DIRECTORY_SEPARATOR . $filename;
    if (!file_exists($stagingFile)) {
        echo json_encode(['success' => false, 'error' => 'Staging file does not exist.']);
        return;
    }

    // Categorized Hill Lists
    $rawPrimary = is_array($data['primaryHills'] ?? null) ? $data['primaryHills'] : [];
    $rawSecondary = is_array($data['secondaryHills'] ?? null) ? $data['secondaryHills'] : [];
    $rawFrom = is_array($data['fromHills'] ?? null) ? $data['fromHills'] : [];

    // Filter valid numeric IDs
    $cleanPrimary = array_values(array_unique(array_filter(array_map('trim', $rawPrimary), fn($v) => preg_match('/^\d+$/', $v))));
    $cleanSecondary = array_values(array_unique(array_filter(array_map('trim', $rawSecondary), fn($v) => preg_match('/^\d+$/', $v))));
    $cleanFrom = array_values(array_unique(array_filter(array_map('trim', $rawFrom), fn($v) => preg_match('/^\d+$/', $v))));

    // Legacy fallback: if hillId was provided and primary is empty
    $legacyHillId = trim((string)($data['hillId'] ?? ''));
    if (empty($cleanPrimary) && $legacyHillId !== '' && preg_match('/^\d+$/', $legacyHillId)) {
        $cleanPrimary[] = $legacyHillId;
    }

    // Rule: At least one hill must be in primary or taken from!
    if (empty($cleanPrimary) && empty($cleanFrom)) {
        echo json_encode([
            'success' => false,
            'error' => 'At least one hill must be selected in Primary Hill(s) or Taken From.'
        ]);
        return;
    }

    // Preserve original filename (normalized to .jpg)
    $baseName = pathinfo($filename, PATHINFO_FILENAME);
    $targetFileName = !empty($data['targetFileName']) ? trim($data['targetFileName']) : ($baseName . '.jpg');
    if (!preg_match('/\.jpe?g$/i', $targetFileName)) {
        $targetFileName = pathinfo($targetFileName, PATHINFO_FILENAME) . '.jpg';
    }

    // Extract CRC for validation and cross-referencing
    $parsed = parsePhotoFilename($filename);
    $crc = strtolower(trim($data['crc'] ?? $parsed['crc'] ?? ''));

    $cropX = (int)round($crop['x'] ?? 0);
    $cropY = (int)round($crop['y'] ?? 0);
    $cropW = (int)round($crop['width'] ?? 0);
    $cropH = (int)round($crop['height'] ?? 0);

    // Format Tags: primary:196|209;secondary:74;from:79
    $tagParts = [];
    if (!empty($cleanPrimary)) {
        $tagParts[] = 'primary:' . implode('|', $cleanPrimary);
    }
    if (!empty($cleanSecondary)) {
        $tagParts[] = 'secondary:' . implode('|', $cleanSecondary);
    }
    if (!empty($cleanFrom)) {
        $tagParts[] = 'from:' . implode('|', $cleanFrom);
    }
    $keywordsStr = implode(';', $tagParts);

    // If browser passed pre-rendered 1600x900 imageBase64 (with rotation, contrast, hue, saturation)
    $croppedFilePath = '';
    $imageBase64 = trim($data['imageBase64'] ?? '');
    if ($imageBase64 !== '') {
        if (preg_match('/^data:image\/\w+;base64,(.+)$/', $imageBase64, $m)) {
            $rawJpeg = base64_decode($m[1]);
        } else {
            $rawJpeg = base64_decode($imageBase64);
        }
        if ($rawJpeg !== false && strlen($rawJpeg) > 100) {
            $tempCropped = $hillsDir . DIRECTORY_SEPARATOR . 'temp_' . $targetFileName;
            file_put_contents($tempCropped, $rawJpeg);
            $croppedFilePath = $tempCropped;
        }
    }

    // Build PowerShell execution command
    $cmdParts = [
        'powershell.exe',
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', escapeshellarg($psScript),
        '-StagingFile', escapeshellarg($stagingFile),
        '-TargetFileName', escapeshellarg($targetFileName),
        '-PrimaryHills', escapeshellarg(implode(',', $cleanPrimary)),
        '-SecondaryHills', escapeshellarg(implode(',', $cleanSecondary)),
        '-FromHills', escapeshellarg(implode(',', $cleanFrom)),
        '-CropX', (string)$cropX,
        '-CropY', (string)$cropY,
        '-CropWidth', (string)$cropW,
        '-CropHeight', (string)$cropH,
        '-Comment', escapeshellarg($comment),
        '-Keywords', escapeshellarg($keywordsStr),
        '-ArchiveFolder', escapeshellarg($archiveDir)
    ];

    if ($croppedFilePath !== '') {
        $cmdParts[] = '-CroppedFile';
        $cmdParts[] = escapeshellarg($croppedFilePath);
    }

    $command = implode(' ', $cmdParts);

    // Execute PowerShell runner
    $descriptor = [
        0 => ['pipe', 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w']
    ];

    $proc = proc_open($command, $descriptor, $pipes);
    if (!is_resource($proc)) {
        echo json_encode(['success' => false, 'error' => 'Failed to initialize crop processor process.']);
        return;
    }

    fclose($pipes[0]);
    $stdout = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[2]);
    $exitCode = proc_close($proc);

    // Clean up temporary cropped file if still present
    if ($croppedFilePath !== '' && file_exists($croppedFilePath)) {
        @unlink($croppedFilePath);
    }

    $jsonResult = @json_decode(trim($stdout), true);
    if ($exitCode === 0 && is_array($jsonResult) && ($jsonResult['success'] ?? false)) {
        echo json_encode([
            'success' => true,
            'message' => 'Photo cropped, saved to hills, and original archived.',
            'savedFile' => $targetFileName,
            'primary' => $cleanPrimary,
            'secondary' => $cleanSecondary,
            'from' => $cleanFrom,
            'comment' => $comment,
            'tags' => $tagParts,
            'archivedTo' => 'image/staging/archive/' . $filename
        ]);
    } else {
        $errMsg = $jsonResult['error'] ?? ($stderr ?: ($stdout ?: 'Unknown error executing PowerShell script.'));
        echo json_encode([
            'success' => false,
            'error' => $errMsg,
            'exitCode' => $exitCode
        ]);
    }
}

/**
 * Removes a photo from the staging folder.
 */
function handleDeleteStaging(string $stagingDir): void {
    $rawInput = file_get_contents('php://input');
    $data = json_decode($rawInput, true);
    $filename = trim($data['filename'] ?? $_POST['filename'] ?? '');

    if ($filename === '') {
        echo json_encode(['success' => false, 'error' => 'Missing filename to delete.']);
        return;
    }

    $fullPath = $stagingDir . DIRECTORY_SEPARATOR . $filename;
    if (file_exists($fullPath)) {
        @unlink($fullPath);
        echo json_encode(['success' => true, 'message' => 'Photo removed from staging.']);
    } else {
        echo json_encode(['success' => false, 'error' => 'File not found.']);
    }
}

/**
 * Removes a photo from the archive folder.
 */
function handleDeleteArchive(string $archiveDir): void {
    $rawInput = file_get_contents('php://input');
    $data = json_decode($rawInput, true);
    $filename = trim($data['filename'] ?? $_POST['filename'] ?? '');

    if ($filename === '') {
        echo json_encode(['success' => false, 'error' => 'Missing filename to delete.']);
        return;
    }

    $fullPath = $archiveDir . DIRECTORY_SEPARATOR . $filename;
    if (file_exists($fullPath)) {
        @unlink($fullPath);
        echo json_encode(['success' => true, 'message' => 'Archived photo deleted.']);
    } else {
        echo json_encode(['success' => false, 'error' => 'File not found in archive.']);
    }
}

/**
 * Parses datetaken_timetaken_crc32 area where the photo was taken.jpg
 */
function parsePhotoFilename(string $filename, ?string $fullPath = null): array {
    $res = [
        'rawDate' => null,
        'rawTime' => null,
        'dateFormatted' => null,
        'timeFormatted' => null,
        'crc' => null,
        'areaHint' => ''
    ];

    $nameWithoutExt = pathinfo($filename, PATHINFO_FILENAME);

    // 1. Standard pattern: 20240512_143022_a1b2c3d4 Glen Coe
    if (preg_match('/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_([a-fA-F0-9]+)\s*(.*)$/', $nameWithoutExt, $m)) {
        $res['rawDate'] = $m[1] . $m[2] . $m[3];
        $res['rawTime'] = $m[4] . $m[5] . $m[6];
        $res['dateFormatted'] = sprintf('%04d-%02d-%02d', $m[1], $m[2], $m[3]);
        $res['timeFormatted'] = sprintf('%02d:%02d:%02d', $m[4], $m[5], $m[6]);
        $res['crc'] = strtolower($m[7]);
        $res['areaHint'] = trim($m[8]);
        return $res;
    }

    // 2. Pattern without CRC between timestamp and area: 20240512_143022 Glen Coe
    if (preg_match('/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\s*(.*)$/', $nameWithoutExt, $m)) {
        $res['rawDate'] = $m[1] . $m[2] . $m[3];
        $res['rawTime'] = $m[4] . $m[5] . $m[6];
        $res['dateFormatted'] = sprintf('%04d-%02d-%02d', $m[1], $m[2], $m[3]);
        $res['timeFormatted'] = sprintf('%02d:%02d:%02d', $m[4], $m[5], $m[6]);
        $res['areaHint'] = trim($m[7]);
    } else {
        $clean = preg_replace('/[_\-]+/', ' ', $nameWithoutExt);
        $res['areaHint'] = trim($clean);
    }

    // 3. Look for 8-hex character CRC anywhere in the filename
    if (empty($res['crc'])) {
        if (preg_match('/(?:^|[_\-\s])([a-fA-F0-9]{8})(?:[_\-\s]|$)/', $nameWithoutExt, $cm)) {
            $res['crc'] = strtolower($cm[1]);
        } elseif (preg_match('/^([a-fA-F0-9]{4,16})$/', $nameWithoutExt, $cm)) {
            $res['crc'] = strtolower($cm[1]);
        }
    }

    return $res;
}
