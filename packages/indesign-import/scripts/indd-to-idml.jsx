/**
 * indd-to-idml.jsx — InDesign ExtendScript
 *
 * 목적: INDD "옵션 지원". .indd 는 독점 바이너리라 Node 로 직접 파싱 불가.
 *       운영자가 InDesign 에서 이 스크립트를 실행하면 폴더 내 모든 .indd 를
 *       같은 위치에 .idml 로 자동 내보낸다. 이후 코어 변환기는 .idml 만 소비한다.
 *
 * 사용법:
 *   1) InDesign 실행
 *   2) File > Scripts 패널에 이 파일 등록(또는 더블클릭) → 실행
 *   3) .indd 가 들어있는 폴더 선택 → 폴더 내 전부 .idml 변환
 *
 * 자동화(헤드리스) 대안: InDesign Server 가 있으면 동일 코드를
 *   `InDesignServer` 인스턴스에서 호출해 무인 변환 파이프라인으로 쓸 수 있다.
 */
#target "indesign"

(function () {
  var folder = Folder.selectDialog('IDML 로 변환할 .indd 파일이 있는 폴더를 선택하세요');
  if (!folder) {
    return;
  }

  var inddFiles = folder.getFiles('*.indd');
  if (!inddFiles || inddFiles.length === 0) {
    alert('선택한 폴더에 .indd 파일이 없습니다.');
    return;
  }

  var ok = 0;
  var fail = 0;
  var log = [];

  // 사용자 상호작용 다이얼로그 억제(폰트 누락 등으로 멈추지 않게)
  var prevLevel = app.scriptPreferences.userInteractionLevel;
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

  for (var i = 0; i < inddFiles.length; i++) {
    var src = inddFiles[i];
    var doc = null;
    try {
      doc = app.open(src, false); // 윈도우 없이 열기
      var out = new File(src.fsName.replace(/\.indd$/i, '.idml'));
      doc.exportFile(ExportFormat.INDESIGN_MARKUP, out); // INDESIGN_MARKUP = IDML
      doc.close(SaveOptions.NO);
      ok++;
      log.push('OK  : ' + out.name);
    } catch (e) {
      fail++;
      log.push('FAIL: ' + src.name + ' — ' + e);
      if (doc !== null) {
        try {
          doc.close(SaveOptions.NO);
        } catch (e2) {
          // ignore
        }
      }
    }
  }

  app.scriptPreferences.userInteractionLevel = prevLevel;

  alert(
    'IDML 변환 완료\n성공 ' + ok + ' / 실패 ' + fail + '\n\n' + log.join('\n')
  );
})();
