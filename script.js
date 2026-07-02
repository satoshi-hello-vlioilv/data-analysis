/**
 * ビジネス向けヒストグラム分析ツール
 * 
 * このアプリケーションはCSVファイルからヒストグラムを生成し、
 * 基本的な統計情報と管理限界線を提供します。管理図の概念を
 * ヒストグラムに適用することで、データの分布特性をより詳細に分析できます。
 * 
 * 主な機能：
 * - CSVファイルのドラッグ＆ドロップまたはファイル選択によるアップロード
 * - データのヒストグラム可視化
 * - 基本的な統計情報の計算と表示
 * - CL（中心線）、UCL（上側管理限界）、LCL（下側管理限界）、3σラインの表示
 * - ヒストグラムの画像ダウンロード
 * - 統計情報のCSVエクスポート
 * - データフィルタリング機能
 * - X軸MIN/MAX範囲の調整
 */
document.addEventListener('DOMContentLoaded', () => {
  // DOM要素の参照
  const dropArea = document.getElementById('dropArea');
  const fileInput = document.getElementById('fileInput');
  const fileInfo = document.getElementById('fileInfo');
  const fileName = document.getElementById('fileName');
  const fileSize = document.getElementById('fileSize');
  const removeFile = document.getElementById('removeFile');
  const dataColumn = document.getElementById('dataColumn');
  const binMethod = document.getElementById('binMethod');
  const binCount = document.getElementById('binCount');
  const binCountValue = document.getElementById('binCountValue');
  const customBinSettings = document.getElementById('customBinSettings');
  const colorScheme = document.getElementById('colorScheme');
  const generateBtn = document.getElementById('generateBtn');
  const histogramControls = document.getElementById('histogramControls');
  const histogram = document.getElementById('histogram');
  const visualizationTitle = document.getElementById('visualizationTitle');
  const placeholder = document.getElementById('placeholder');
  const loading = document.getElementById('loading');
  const chartControls = document.getElementById('chartControls');
  const downloadBtn = document.getElementById('downloadBtn');
  const exportBtn = document.getElementById('exportBtn');
  const alertContainer = document.getElementById('alert-container');
  const tooltip = document.getElementById('tooltip');
  const notification = document.getElementById('notification');
  const notificationTitle = document.getElementById('notificationTitle');
  const notificationMessage = document.getElementById('notificationMessage');
  const statisticsContainer = document.getElementById('statisticsContainer');
  const distributionInfo = document.getElementById('distributionInfo');
  const distributionTypeText = document.getElementById('distributionTypeText');
  const dataCount = document.getElementById('dataCount');
  const mean = document.getElementById('mean');
  const median = document.getElementById('median');
  const stdDev = document.getElementById('stdDev');
  const minValue = document.getElementById('minValue');
  const maxValue = document.getElementById('maxValue');
  const kurtosis = document.getElementById('kurtosis');
  const skewness = document.getElementById('skewness');

  // 制御限界線設定用の要素
  const clValue = document.getElementById('clValue');
  const uclValue = document.getElementById('uclValue');
  const lclValue = document.getElementById('lclValue');
  const resetCL = document.getElementById('resetCL');
  const resetUCL = document.getElementById('resetUCL');
  const resetLCL = document.getElementById('resetLCL');
  const showSigmaLines = document.getElementById('showSigmaLines');
  
  // X軸表示範囲コントロール用の要素
  const xAxisZoom = document.getElementById('xAxisZoom');
  const xAxisZoomValue = document.getElementById('xAxisZoomValue');
  
  // X軸MIN/MAX範囲スライダー用の要素
  const minRangeSlider = document.getElementById('minRangeSlider');
  const maxRangeSlider = document.getElementById('maxRangeSlider');
  const minRangeValue = document.getElementById('minRangeValue');
  const maxRangeValue = document.getElementById('maxRangeValue');
  
  // フィルター関連の要素
  const filterControls = document.getElementById('filterControls');
  const filterContainer = document.getElementById('filterContainer');
  const applyFilterBtn = document.getElementById('applyFilterBtn');

  // アプリケーションの状態
  const state = {
    csvData: null,             // 解析済みCSVデータ
    originalData: null,        // フィルタリング前のオリジナルデータ
    columns: [],               // 数値データのカラム
    numericColumns: [],        // 数値データのカラム
    categoricalColumns: [],    // カテゴリデータのカラム
    selectedColumn: '',        // 選択されたカラム
    binMethodValue: 'sturges', // 階級設定方法
    binCountValue: 10,         // 階級数
    colorSchemeValue: 'blue',  // カラースキーム
    chart: null,               // Chart.jsインスタンス
    statistics: null,          // 統計情報
    processing: false,         // 処理中フラグ
    // 制御限界線設定
    controlLimits: {
      cl: null,               // 中心線値（通常は平均値）
      ucl: null,              // 上側管理限界値（通常はCL + 3σ）
      lcl: null,              // 下側管理限界値（通常はCL - 3σ）
      showSigmaLines: true,   // 3σラインを表示するかどうか
    },
    // X軸表示範囲設定
    xAxisZoom: {
      factor: 1,              // 表示倍率（1〜10）
      center: null,           // 表示中心値
      min: null,              // 表示最小値
      max: null               // 表示最大値
    },
    // X軸MIN/MAX範囲設定
    xAxisRange: {
      dataMin: null,          // データの最小値
      dataMax: null,          // データの最大値
      displayMin: null,       // 表示する最小値
      displayMax: null,       // 表示する最大値
    },
    // フィルタ設定
    filters: [],              // フィルタの配列
    activeFilters: false      // フィルタが適用されているかどうか
  };

  // カラースキーム設定
  const colorSchemes = {
    blue: ['rgba(52, 152, 219, 0.2)', 'rgba(52, 152, 219, 0.4)', 'rgba(52, 152, 219, 0.6)', 'rgba(52, 152, 219, 0.8)', 'rgba(52, 152, 219, 1)'],
    green: ['rgba(46, 204, 113, 0.2)', 'rgba(46, 204, 113, 0.4)', 'rgba(46, 204, 113, 0.6)', 'rgba(46, 204, 113, 0.8)', 'rgba(46, 204, 113, 1)'],
    purple: ['rgba(155, 89, 182, 0.2)', 'rgba(155, 89, 182, 0.4)', 'rgba(155, 89, 182, 0.6)', 'rgba(155, 89, 182, 0.8)', 'rgba(155, 89, 182, 1)'],
    orange: ['rgba(230, 126, 34, 0.2)', 'rgba(230, 126, 34, 0.4)', 'rgba(230, 126, 34, 0.6)', 'rgba(230, 126, 34, 0.8)', 'rgba(230, 126, 34, 1)']
  };

  /**
   * ラベルの重なりをチェックする関数
   * @param {Array<string>} labels - チェックするラベルの配列
   * @param {number} width - 利用可能な幅
   * @return {boolean} 重なりがあるかどうか
   */
  function checkLabelOverlap(labels, width) {
    // canvas要素のコンテキストを取得
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = '10px sans-serif';
    
    // 各ラベルの幅を計算
    const labelWidths = labels.map(label => ctx.measureText(label).width);
    
    // 利用可能な幅を計算
    const availableWidth = width * 0.8;
    
    // 必要な合計幅を計算
    const totalLabelWidth = labelWidths.reduce((sum, width) => sum + width, 0);
    
    // ラベル間の最小間隔
    const minSpacing = 10;
    const totalSpacing = (labels.length - 1) * minSpacing;
    
    // 判定
    return (totalLabelWidth + totalSpacing) > availableWidth;
  }

  /**
   * アラートを表示する
   * @param {string} type - アラートタイプ（'info', 'warning', 'error', 'success'）
   * @param {string} message - 表示するメッセージ
   * @param {number} [timeout=0] - 自動で消えるまでの時間（ミリ秒）、0の場合は自動で消えない
   */
  function showAlert(type, message, timeout = 0) {
    // 既存のアラートをクリア
    const existingAlerts = alertContainer.querySelectorAll('.alert');
    existingAlerts.forEach(alert => alert.remove());

    // アラートを作成
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    
    // アイコンを設定
    let iconSvg = '';
    switch (type) {
      case 'info':
        iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
        break;
      case 'warning':
        iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
        break;
      case 'error':
        iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
        break;
      case 'success':
        iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
        break;
    }

    // アラート内容を設定
    alert.innerHTML = `
      ${iconSvg}
      <div class="alert-content">
        <strong>${type.charAt(0).toUpperCase() + type.slice(1)}</strong>
        <p>${message}</p>
      </div>
    `;

    // アラートを追加
    alertContainer.appendChild(alert);

    // タイムアウトが設定されている場合は自動で消す
    if (timeout > 0) {
      setTimeout(() => {
        alert.style.opacity = '0';
        alert.style.transform = 'translateY(-10px)';
        alert.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
        
        setTimeout(() => {
          if (alert.parentNode) {
            alert.parentNode.removeChild(alert);
          }
        }, 300);
      }, timeout);
    }
  }

  /**
   * 通知を表示する
   * @param {string} title - 通知タイトル
   * @param {string} message - 通知メッセージ
   * @param {number} [timeout=3000] - 表示時間（ミリ秒）
   */
  function showNotification(title, message, timeout = 3000) {
    notificationTitle.textContent = title;
    notificationMessage.textContent = message;
    notification.classList.add('active');
    
    setTimeout(() => {
      notification.classList.remove('active');
    }, timeout);
  }

  /**
   * ファイルサイズを人間が読める形式に変換する
   * @param {number} bytes - バイト数
   * @return {string} フォーマットされたサイズ
   */
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * ファイル情報を表示する
   * @param {File} file - 表示するファイル
   */
  function showFileInfo(file) {
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    fileInfo.classList.add('active');
  }

  /**
   * ファイル情報をクリアする
   */
  function clearFileInfo() {
    fileName.textContent = '';
    fileSize.textContent = '';
    fileInfo.classList.remove('active');
  }

  /**
   * 処理状態を設定する
   * @param {boolean} isProcessing - 処理中かどうか
   */
  function setProcessing(isProcessing) {
    state.processing = isProcessing;
    
    if (isProcessing) {
      loading.style.display = 'flex';
    } else {
      loading.style.display = 'none';
    }
  }

  /**
   * カラムの種類を判別する（数値型、カテゴリ型）
   * @param {Array} data - データ配列
   */
  function categorizeColumns(data) {
    if (!data || data.length === 0 || !state.columns || state.columns.length === 0) return;
    
    state.numericColumns = [];
    state.categoricalColumns = [];
    
    // サンプルとして先頭10行を使用
    const sampleSize = Math.min(10, data.length);
    const sampleData = data.slice(0, sampleSize);
    
    // 各カラムをチェック
    state.columns.forEach(column => {
      let isNumeric = true;
      
      // すべてのサンプルデータで数値かどうかをチェック
      for (let i = 0; i < sampleSize; i++) {
        const value = sampleData[i][column];
        if (typeof value !== 'number' || isNaN(value)) {
          isNumeric = false;
          break;
        }
      }
      
      // 分類結果を保存
      if (isNumeric) {
        state.numericColumns.push(column);
      } else {
        state.categoricalColumns.push(column);
      }
    });
  }

  /**
   * ファイルを処理する
   * @param {File} file - 処理するファイル
   */
  function processFile(file) {
    if (!file) return;
    
    // ファイル情報を表示
    showFileInfo(file);
    
    // 処理中状態にする
    setProcessing(true);
    
    // ファイルタイプに基づいて処理
    const fileExtension = file.name.split('.').pop().toLowerCase();
    
    if (fileExtension === 'csv') {
      // CSVファイル処理
      parseCSV(file);
    } else if (['xls', 'xlsx'].includes(fileExtension)) {
      // Excelファイル処理
      parseExcel(file);
    } else {
      setProcessing(false);
      showAlert('error', 'サポートされていないファイル形式です。CSV、XLS、またはXLSXファイルを使用してください。', 5000);
    }
  }

  /**
   * CSVファイルを解析する
   * @param {File} file - 解析するCSVファイル
   */
  function parseCSV(file) {
    if (!file) return;
    
    // ファイル情報を表示
    showFileInfo(file);
    
    // 処理中状態にする
    setProcessing(true);
    
    // ファイルの内容を読み込んで解析
    const reader = new FileReader();
    reader.onload = function(e) {
      const fileContent = e.target.result;
      const lines = fileContent.split(/\r\n|\n/).filter(line => line.trim().length > 0);
      
      if (lines.length === 0) {
        setProcessing(false);
        showAlert('warning', 'CSVファイルにデータが含まれていません。', 5000);
        return;
      }
      
      // 単一の値だけが各行にある場合の特別処理
      const isSingleValuePerLine = lines.every(line => 
        !line.includes(',') && !line.includes('\t') && !line.includes(';')
      );
      
      if (isSingleValuePerLine) {
        try {
          // 最初の行がヘッダーかどうかをチェック
          const firstLine = lines[0].trim();
          const isFirstLineHeader = isNaN(parseFloat(firstLine)) || 
                                  firstLine === "Value" || 
                                  firstLine === "値" || 
                                  /^[a-zA-Z_]+$/.test(firstLine);
          
          // 解析開始行のインデックス（ヘッダーがある場合は1から、なければ0から）
          const startIndex = isFirstLineHeader ? 1 : 0;
          
          // 各行を数値に変換
          const numericData = lines
            .slice(startIndex)
            .map(line => line.trim())
            .filter(line => line !== '')
            .map(line => {
              const parsed = parseFloat(line);
              if (isNaN(parsed)) {
                throw new Error(`「${line}」を数値に変換できません`);
              }
              return parsed;
            });
          
          if (numericData.length === 0) {
            setProcessing(false);
            showAlert('warning', '有効な数値データが見つかりませんでした。', 5000);
            return;
          }
          
          // データオブジェクトを作成
          const processedData = numericData.map(value => ({ 'Value': value }));
          
          // データ処理完了
          setProcessing(false);
          state.csvData = processedData;
          state.originalData = [...processedData]; // オリジナルデータを保存
          state.columns = ['Value'];
          
          // カラムの種類を分類
          categorizeColumns(state.csvData);
          
          // カラム選択肢を更新
          updateColumnSelect(state.numericColumns);
          
          histogramControls.style.display = 'block';
          showAlert('success', `${processedData.length.toLocaleString()}行のデータを読み込みました。`, 3000);
          
        } catch (err) {
          setProcessing(false);
          showAlert('error', `データ処理に失敗しました: ${err.message}`, 5000);
        }
        
        return;
      }
      
      // 区切り文字を検出
      const possibleDelimiters = [',', '\t', ';', '|'];
      let bestDelimiter = ',';
      let maxColumns = 0;
      
      // サンプルとして最初の数行を使用
      const sampleLines = lines.slice(0, Math.min(5, lines.length));
      
      for (const delimiter of possibleDelimiters) {
        const columns = sampleLines.map(line => line.split(delimiter).length);
        const avgColumns = columns.reduce((a, b) => a + b, 0) / columns.length;
        
        if (avgColumns > maxColumns) {
          maxColumns = avgColumns;
          bestDelimiter = delimiter;
        }
      }
      
      // 数値データのみかどうかを判断（ヘッダーの有無）
      let hasHeaders = false;
      const firstLineValues = lines[0].split(bestDelimiter);
      
      // 最初の行が数値だけならヘッダーなしと判断
      hasHeaders = firstLineValues.some(val => {
        const trimmed = val.trim();
        const parsed = parseFloat(trimmed);
        return isNaN(parsed) || (trimmed !== parsed.toString() && trimmed !== '');
      });
      
      // 通常のCSVとして処理
      Papa.parse(fileContent, {
        header: hasHeaders,
        delimiter: bestDelimiter,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: function(results) {
          setProcessing(false);
          
          // エラーチェック
          if (results.errors.length > 0 && results.data.length === 0) {
            showAlert('error', `CSVの解析中にエラーが発生しました: ${results.errors[0].message}`, 5000);
            return;
          }
          
          if (results.data.length === 0) {
            showAlert('warning', 'CSVファイルにデータが含まれていません。', 5000);
            return;
          }
          
          let processedData;
          let allColumns = []; // すべてのカラム（数値・非数値含む）
          let numericColumns = []; // 数値データのカラムのみ
          
          // ヘッダーなしデータの処理
          if (!hasHeaders) {
            // 配列データを整形
            processedData = results.data.map((row, index) => {
              // 配列形式のデータをオブジェクトに変換
              if (Array.isArray(row)) {
                const obj = {};
                row.forEach((value, colIndex) => {
                  const colName = `Value_${colIndex + 1}`;
                  obj[colName] = value;
                  
                  // すべてのカラムを記録
                  if (index === 0 && !allColumns.includes(colName)) {
                    allColumns.push(colName);
                    
                    // 数値データの列も記録
                    if (typeof value === 'number' && !isNaN(value)) {
                      numericColumns.push(colName);
                    }
                  }
                });
                return obj;
              }
              // 単一値の場合
              else if (typeof row === 'number' && !isNaN(row)) {
                if (index === 0) {
                  allColumns.push('Value');
                  numericColumns.push('Value');
                }
                return { 'Value': row };
              }
              return row;
            });
          } else {
            // ヘッダーありデータの処理（通常の処理）
            processedData = results.data;
            
            // すべてのカラムと数値データを含むカラムを抽出
            const sampleRow = results.data[0];
            
            for (const key in sampleRow) {
              allColumns.push(key);
              
              if (typeof sampleRow[key] === 'number' && !isNaN(sampleRow[key])) {
                numericColumns.push(key);
              }
            }
          }
          
          if (numericColumns.length === 0) {
            showAlert('warning', '数値データを含む列が見つかりませんでした。', 5000);
            return;
          }
          
          // データを保存
          state.csvData = processedData;
          state.originalData = [...processedData]; // オリジナルデータを保存
          
          // すべてのカラムと数値カラムを保存
          state.columns = allColumns;
          
          // カラムの種類を分類
          categorizeColumns(state.csvData);
          
          // カラム選択肢を更新
          updateColumnSelect(state.numericColumns);
          
          // コントロールを表示
          histogramControls.style.display = 'block';
          
          // 成功メッセージを表示
          showAlert('success', `${processedData.length.toLocaleString()}行のデータを読み込みました。`, 3000);
        },
        error: function(error) {
          setProcessing(false);
          showAlert('error', `ファイルの解析に失敗しました: ${error.message}`, 5000);
        }
      });
    };
    
    reader.onerror = function() {
      setProcessing(false);
      showAlert('error', 'ファイルの読み込みに失敗しました。', 5000);
    };
    
    reader.readAsText(file);
  }

  /**
   * Excelファイルを解析する
   * @param {File} file - 解析するExcelファイル
   */
  function parseExcel(file) {
    const reader = new FileReader();
    
    reader.onload = function(e) {
      try {
        // ファイルデータをバイナリ文字列として取得
        const data = new Uint8Array(e.target.result);
        
        // SheetJSを使用してワークブックを解析
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        
        // 最初のシートを取得
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // ワークシートからJSONデータを抽出
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true });
        
        if (jsonData.length === 0) {
          setProcessing(false);
          showAlert('warning', 'Excelファイルにデータが含まれていません。', 5000);
          return;
        }
        
        // 1行目がヘッダーかどうかを判断
        let hasHeaders = false;
        const firstRow = jsonData[0];
        
        if (firstRow && firstRow.length > 0) {
          // 最初の行が数値だけならヘッダーなしと判断
          hasHeaders = firstRow.some(val => {
            if (val === undefined || val === null) return false;
            return typeof val !== 'number' || isNaN(val);
          });
        }
        
        // 処理用のデータを準備
        let processedData = [];
        let allColumns = []; // すべてのカラム（数値・非数値含む）
        let numericColumns = []; // 数値データのカラムのみ
        
        if (hasHeaders) {
          // ヘッダーがある場合
          const headers = jsonData.shift();
          
          processedData = jsonData.map(row => {
            const rowData = {};
            headers.forEach((header, index) => {
              if (header) {
                rowData[header] = row[index];
                
                // すべてのカラムを記録
                if (!allColumns.includes(header)) {
                  allColumns.push(header);
                }
              }
            });
            return rowData;
          });
          
          // 数値データを含むカラムを特定
          if (processedData.length > 0) {
            const sampleRow = processedData[0];
            headers.forEach(header => {
              if (header && typeof sampleRow[header] === 'number' && !isNaN(sampleRow[header])) {
                numericColumns.push(header);
              }
            });
          }
        } else {
          // ヘッダーがない場合
          // すべての行が単一の数値のみを含むかチェック
          const isSingleValuePerRow = jsonData.every(row => 
            row.length === 1 && typeof row[0] === 'number' && !isNaN(row[0])
          );
          
          if (isSingleValuePerRow) {
            // 単一の数値列のデータとして処理
            processedData = jsonData.map(row => ({ 'Value': row[0] }));
            allColumns = ['Value'];
            numericColumns = ['Value'];
          } else {
            // 複数列のデータとして処理
            processedData = jsonData.map(row => {
              const rowData = {};
              row.forEach((value, index) => {
                const colName = `Value_${index + 1}`;
                rowData[colName] = value;
                
                // すべてのカラムを記録
                if (!allColumns.includes(colName)) {
                  allColumns.push(colName);
                }
              });
              return rowData;
            });
            
            // 数値データを含むカラムを特定
            if (processedData.length > 0) {
              const sampleRow = processedData[0];
              for (const key in sampleRow) {
                if (typeof sampleRow[key] === 'number' && !isNaN(sampleRow[key])) {
                  numericColumns.push(key);
                }
              }
            }
          }
        }
        
        if (numericColumns.length === 0) {
          setProcessing(false);
          showAlert('warning', '数値データを含む列が見つかりませんでした。', 5000);
          return;
        }
        
        // データを保存
        state.csvData = processedData;
        state.originalData = [...processedData]; // オリジナルデータを保存
        state.columns = allColumns;
        
        // カラムの種類を分類
        categorizeColumns(state.csvData);
        
        // カラム選択肢を更新
        updateColumnSelect(state.numericColumns);
        
        // コントロールを表示
        histogramControls.style.display = 'block';
        
        // 処理完了
        setProcessing(false);
        
        // 成功メッセージを表示
        showAlert('success', `${processedData.length.toLocaleString()}行のデータを読み込みました。`, 3000);
        
      } catch (error) {
        setProcessing(false);
        showAlert('error', `Excelファイルの解析に失敗しました: ${error.message}`, 5000);
      }
    };
    
    reader.onerror = function() {
      setProcessing(false);
      showAlert('error', 'ファイルの読み込みに失敗しました。', 5000);
    };
    
    // ファイルをバイナリ文字列として読み込む
    reader.readAsArrayBuffer(file);
  }

  /**
   * カラム選択肢を更新する
   * @param {Array<string>} columns - 数値データのカラム名リスト
   */
  function updateColumnSelect(columns) {
    // 以前の選択肢をクリア
    dataColumn.innerHTML = '';
    
    // デフォルトオプションを追加
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '分析する列を選択してください';
    dataColumn.appendChild(defaultOption);
    
    // 数値カラムを追加
    columns.forEach(column => {
      const option = document.createElement('option');
      option.value = column;
      option.textContent = column;
      dataColumn.appendChild(option);
    });
    
    // 選択状態を初期化
    state.selectedColumn = '';
    dataColumn.disabled = false;
    colorScheme.disabled = false;
    generateBtn.disabled = true;
    
    // 管理限界線フィールドをリセット
    clValue.value = '';
    uclValue.value = '';
    lclValue.value = '';
    clValue.placeholder = '平均値を自動設定';
    uclValue.placeholder = 'CL + 3σ';
    lclValue.placeholder = 'CL - 3σ';
    
    // フィルターコントロールを非表示にする
    filterControls.style.display = 'none';
  }

  /**
   * フィルターUIを作成する
   */
  function createFilterUI() {
    // フィルターコンテナをクリア
    filterContainer.innerHTML = '';
    
    // 現在のフィルターを表示
    state.filters.forEach((filter, index) => {
      addFilterRow(filter.column, filter.operator, filter.value, index);
    });
    
    // フィルター追加ボタンを表示
    const addFilterButton = document.createElement('div');
    addFilterButton.className = 'add-filter-btn';
    addFilterButton.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      フィルターを追加
    `;
    
    addFilterButton.addEventListener('click', () => {
      // 新しいフィルターを追加
      const newFilter = {
        column: '',
        operator: '=',
        value: ''
      };
      
      state.filters.push(newFilter);
      addFilterRow(newFilter.column, newFilter.operator, newFilter.value, state.filters.length - 1);
      
      // ボタンを一旦削除して最後に追加し直す
      filterContainer.removeChild(addFilterButton);
      filterContainer.appendChild(addFilterButton);
    });
    
    filterContainer.appendChild(addFilterButton);
  }

  /**
   * フィルター行を追加する
   * @param {string} column - カラム名
   * @param {string} operator - 演算子
   * @param {string|number} value - フィルター値
   * @param {number} index - フィルターのインデックス
   */
  function addFilterRow(column, operator, value, index) {
    const filterRow = document.createElement('div');
    filterRow.className = 'filter-row';
    filterRow.dataset.index = index;
    
    // カラム選択
    const columnSelect = document.createElement('select');
    columnSelect.className = 'form-control filter-column';
    
    // デフォルトオプション
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'カラムを選択';
    columnSelect.appendChild(defaultOption);
    
    // 選択された分析軸以外のカラムをオプションとして追加
    state.columns.forEach(col => {
      if (col !== state.selectedColumn) {
        const option = document.createElement('option');
        option.value = col;
        option.textContent = col;
        
        if (col === column) {
          option.selected = true;
        }
        
        columnSelect.appendChild(option);
      }
    });
    
    // 演算子選択
    const operatorSelect = document.createElement('select');
    operatorSelect.className = 'form-control filter-operator';
    
    // 数値演算子
    const numericOperators = [
      { value: '=', text: '=' },
      { value: '!=', text: '≠' },
      { value: '>', text: '>' },
      { value: '<', text: '<' },
      { value: '>=', text: '≥' },
      { value: '<=', text: '≤' }
    ];
    
    // テキスト演算子
    const textOperators = [
      { value: '=', text: '=' },
      { value: '!=', text: '≠' },
      { value: 'contains', text: '含む' },
      { value: 'not_contains', text: '含まない' },
      { value: 'starts_with', text: '始まる' },
      { value: 'ends_with', text: '終わる' }
    ];
    
    // デフォルトでは数値演算子を表示
    let operatorsToUse = numericOperators;
    
    // もし選択されたカラムがあれば、そのカラムの型に基づいて演算子を設定
    if (column) {
      const isNumeric = state.numericColumns.includes(column);
      operatorsToUse = isNumeric ? numericOperators : textOperators;
    }
    
    // 演算子オプションを追加
    operatorsToUse.forEach(op => {
      const option = document.createElement('option');
      option.value = op.value;
      option.textContent = op.text;
      
      if (op.value === operator) {
        option.selected = true;
      }
      
      operatorSelect.appendChild(option);
    });
    
    // 値入力
    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'form-control filter-value';
    valueInput.value = value !== null && value !== undefined ? value : '';
    valueInput.placeholder = '値を入力';
    
    // 削除ボタン
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'remove-filter';
    removeButton.title = 'フィルターを削除';
    removeButton.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
    
    // イベントリスナー
    columnSelect.addEventListener('change', e => {
      const selectedColumn = e.target.value;
      state.filters[index].column = selectedColumn;
      
      // カラムの型に基づいて演算子を更新
      const isNumeric = state.numericColumns.includes(selectedColumn);
      const newOperatorsToUse = isNumeric ? numericOperators : textOperators;
      
      // 演算子選択をクリアして再構築
      operatorSelect.innerHTML = '';
      
      newOperatorsToUse.forEach(op => {
        const option = document.createElement('option');
        option.value = op.value;
        option.textContent = op.text;
        operatorSelect.appendChild(option);
      });
      
      // デフォルト演算子を設定
      state.filters[index].operator = newOperatorsToUse[0].value;
      operatorSelect.value = newOperatorsToUse[0].value;
    });
    
    operatorSelect.addEventListener('change', e => {
      state.filters[index].operator = e.target.value;
    });
    
    valueInput.addEventListener('input', e => {
      state.filters[index].value = e.target.value;
    });
    
    removeButton.addEventListener('click', () => {
      // フィルターを配列から削除
      state.filters.splice(index, 1);
      
      // UI要素を削除
      filterRow.remove();
      
      // インデックスを更新
      const filterRows = filterContainer.querySelectorAll('.filter-row');
      filterRows.forEach((row, i) => {
        row.dataset.index = i;
      });
      
      // フィルターUIを再構築
      createFilterUI();
    });
    
    // 要素をフィルター行に追加
    filterRow.appendChild(columnSelect);
    filterRow.appendChild(operatorSelect);
    filterRow.appendChild(valueInput);
    filterRow.appendChild(removeButton);
    
    // フィルターコンテナに行を追加
    filterContainer.appendChild(filterRow);
  }

  /**
   * フィルターを適用してデータをフィルタリングする
   */
  function applyFilters() {
    // フィルターがなければ何もしない
    if (state.filters.length === 0) {
      state.csvData = [...state.originalData];
      state.activeFilters = false;
      return;
    }
    
    // フィルターが有効なものだけを抽出
    const validFilters = state.filters.filter(filter => 
      filter.column && filter.operator && (filter.value !== null && filter.value !== undefined && filter.value !== '')
    );
    
    // 有効なフィルターがなければオリジナルデータを使用
    if (validFilters.length === 0) {
      state.csvData = [...state.originalData];
      state.activeFilters = false;
      return;
    }
    
    // フィルターを適用
    state.csvData = state.originalData.filter(row => {
      // すべてのフィルター条件に一致するかをチェック
      return validFilters.every(filter => {
        const { column, operator, value } = filter;
        const rowValue = row[column];
        
        // rowValueがundefinedの場合は条件に一致しないと判断
        if (rowValue === undefined || rowValue === null) {
          return false;
        }
        
        // 数値型かどうかを判断
        const isNumeric = state.numericColumns.includes(column);
        
        // 数値型の場合
        if (isNumeric) {
          const numValue = parseFloat(value);
          
          switch (operator) {
            case '=': return rowValue === numValue;
            case '!=': return rowValue !== numValue;
            case '>': return rowValue > numValue;
            case '<': return rowValue < numValue;
            case '>=': return rowValue >= numValue;
            case '<=': return rowValue <= numValue;
            default: return true;
          }
        } 
        // 文字列型の場合
        else {
          const strRowValue = String(rowValue).toLowerCase();
          const strValue = String(value).toLowerCase();
          
          switch (operator) {
            case '=': return strRowValue === strValue;
            case '!=': return strRowValue !== strValue;
            case 'contains': return strRowValue.includes(strValue);
            case 'not_contains': return !strRowValue.includes(strValue);
            case 'starts_with': return strRowValue.startsWith(strValue);
            case 'ends_with': return strRowValue.endsWith(strValue);
            default: return true;
          }
        }
      });
    });
    
    // フィルター状態を設定
    state.activeFilters = true;
    
    // フィルター適用後のデータ数を通知
    showNotification(
      'フィルター適用完了', 
      `${state.csvData.length.toLocaleString()}行のデータがフィルター条件に一致しました。`
    );
  }

  /**
   * 管理限界線の値を計算、設定する
   * @param {Object} stats - 統計情報オブジェクト
   */
  function setControlLimits(stats) {
    // 中心線を平均値に設定
    const cl = stats.mean;
    const sigma = stats.stdDev;
    
    // 上側管理限界（+3σ）と下側管理限界（-3σ）を計算
    const ucl = cl + (3 * sigma);
    const lcl = cl - (3 * sigma);
    
    // 状態を更新
    state.controlLimits.cl = cl;
    state.controlLimits.ucl = ucl;
    state.controlLimits.lcl = lcl;
    
    // 入力フィールドに表示
    clValue.value = cl.toFixed(2);
    uclValue.value = ucl.toFixed(2);
    lclValue.value = lcl.toFixed(2);
  }

  /**
   * X軸範囲スライダーの初期化と更新
   * @param {number} min - データの最小値
   * @param {number} max - データの最大値
   */
  function initRangeSliders(min, max) {
    // データの範囲を状態に保存
    state.xAxisRange.dataMin = min;
    state.xAxisRange.dataMax = max;
    state.xAxisRange.displayMin = min;
    state.xAxisRange.displayMax = max;
    
    // 表示値を更新
    minRangeValue.textContent = min.toFixed(2);
    maxRangeValue.textContent = max.toFixed(2);
    
    // スライダーの表示トラックを更新
    updateRangeSliderTrack();
  }

  /**
   * 範囲スライダーの表示トラックを更新
   */
  function updateRangeSliderTrack() {
    const minVal = parseInt(minRangeSlider.value);
    const maxVal = parseInt(maxRangeSlider.value);
    
    // スライダートラックのスタイルを更新
    const track = document.querySelector('.range-slider-track');
    if (track) {
      track.style.left = (minVal) + '%';
      track.style.width = (maxVal - minVal) + '%';
    }
    
    // スライダートラックの前要素のスタイルを更新
    const trackBefore = document.querySelector('.range-slider-track:before');
    if (trackBefore) {
      trackBefore.style.left = (minVal) + '%';
      trackBefore.style.width = (maxVal - minVal) + '%';
    }
    
    // 表示範囲の実際の値を計算
    const range = state.xAxisRange.dataMax - state.xAxisRange.dataMin;
    const displayMin = state.xAxisRange.dataMin + (range * minVal / 100);
    const displayMax = state.xAxisRange.dataMin + (range * maxVal / 100);
    
    // 状態と表示値を更新
    state.xAxisRange.displayMin = displayMin;
    state.xAxisRange.displayMax = displayMax;
    minRangeValue.textContent = displayMin.toFixed(2);
    maxRangeValue.textContent = displayMax.toFixed(2);
    
    // チャートがあれば更新
    if (state.chart) {
      state.chart.options.scales.x.min = displayMin;
      state.chart.options.scales.x.max = displayMax;
      state.chart.update();
    }
  }

  /**
   * ヒストグラムを生成する
   */
  function generateHistogram() {
    if (!state.csvData || !state.selectedColumn || state.processing) return;
    
    // 処理中状態にする
    setProcessing(true);
    
    // 選択されたカラムのデータを抽出
    const columnData = state.csvData
      .map(row => row[state.selectedColumn])
      .filter(value => typeof value === 'number' && !isNaN(value));
    
    if (columnData.length === 0) {
      setProcessing(false);
      showAlert('error', '選択された列に有効な数値データがありません。', 5000);
      return;
    }
    
    // 適切な階級数を決定
    let bins;
    
    switch (state.binMethodValue) {
      case 'sturges':
        bins = Math.ceil(Math.log2(columnData.length) + 1);
        break;
      case 'scott':
        const stdDev = calculateStandardDeviation(columnData);
        bins = Math.ceil(3.5 * stdDev / Math.pow(columnData.length, 1/3));
        if (bins < 5) bins = 5;
        break;
      case 'freedman':
        // フリードマン-ダイアコニスの方法
        const sortedData = [...columnData].sort((a, b) => a - b);
        const q1 = sortedData[Math.floor(sortedData.length * 0.25)];
        const q3 = sortedData[Math.floor(sortedData.length * 0.75)];
        const iqr = q3 - q1;
        
        bins = Math.ceil(2 * iqr / Math.pow(columnData.length, 1/3));
        if (bins < 5) bins = 5;
        break;
      case 'custom':
        bins = state.binCountValue;
        break;
      default:
        bins = 10;
    }
    
    // 統計情報を計算
    const stats = calculateStatistics(columnData);
    state.statistics = stats;
    
    // 管理限界線を設定
    setControlLimits(stats);
    
    // X軸範囲スライダーを初期化
    initRangeSliders(stats.min, stats.max);
    
    // ヒストグラムを描画
    setTimeout(() => {
      // プレースホルダーを非表示にする
      placeholder.style.display = 'none';
      
      // キャンバスがすでに存在する場合は削除
      const existingCanvas = histogram.querySelector('canvas');
      if (existingCanvas) {
        existingCanvas.remove();
      }
      
      // キャンバスを作成
      const canvas = document.createElement('canvas');
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      histogram.appendChild(canvas);
      
      // chart.jsコンテキストを取得
      const ctx = canvas.getContext('2d');
      
      // データの最小値と最大値を取得
      const minVal = Math.min(...columnData);
      const maxVal = Math.max(...columnData);
      
      // データ範囲を計算
      const range = maxVal - minVal;
      
      // ビンの幅を計算
      const binWidth = range / bins;
      
      // ヒストグラムデータを準備
      const histogramData = [];
      const labels = [];
      
      for (let i = 0; i < bins; i++) {
        const binStart = minVal + (binWidth * i);
        const binEnd = minVal + (binWidth * (i + 1));
        
        // 各ビンにデータポイントをカウント
        const count = columnData.filter(value => {
          if (i === bins - 1) {
            // 最後のビンは最大値を含める
            return value >= binStart && value <= binEnd;
          } else {
            return value >= binStart && value < binEnd;
          }
        }).length;
        
        histogramData.push(count);
        labels.push(`${binStart.toFixed(2)} - ${binEnd.toFixed(2)}`);
      }
      
      // 選択された色スキーム
      const colors = colorSchemes[state.colorSchemeValue];
      
      // 正規分布のオーバーレイデータ
      const normalDistribution = calculateNormalDistribution(
        columnData, minVal, maxVal, bins, stats.mean, stats.stdDev
      );
      
      // 管理限界線の値を取得
      let clVal = parseFloat(clValue.value) || state.controlLimits.cl;
      let uclVal = parseFloat(uclValue.value) || state.controlLimits.ucl;
      let lclVal = parseFloat(lclValue.value) || state.controlLimits.lcl;
      
      // 3σ位置の値を計算 (表示する場合のみ)
      const sigmaPlusOne = clVal + stats.stdDev;
      const sigmaPlusTwo = clVal + (2 * stats.stdDev);
      const sigmaMinusOne = clVal - stats.stdDev;
      const sigmaMinusTwo = clVal - (2 * stats.stdDev);
      
      // ヒストグラムの描画
      if (state.chart) {
        state.chart.destroy();
      }
      
      // Chart.jsの設定
      Chart.defaults.font.size = 11;
      
      // X軸の範囲を計算
      state.xAxisZoom.center = (minVal + maxVal) / 2;
      updateXAxisRange(false); // チャートはまだないので更新しない
      
      state.chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'ヒストグラム',
              data: histogramData,
              backgroundColor: (() => {
                // 色勾配を生成
                return histogramData.map((_, i) => {
                  const colorIndex = Math.min(
                    Math.floor((i / bins) * colors.length),
                    colors.length - 1
                  );
                  return colors[colorIndex];
                });
              })(),
              borderColor: 'rgba(0, 0, 0, 0.1)',
              borderWidth: 1,
              barPercentage: 1,
              categoryPercentage: 0.95
            },
            {
              label: '正規分布',
              data: normalDistribution,
              type: 'line',
              borderColor: 'rgba(231, 76, 60, 1)',
              borderWidth: 2,
              pointRadius: 0,
              fill: false,
              tension: 0.4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: {
              top: 10,
              right: 10,
              bottom: 10,
              left: 10
            }
          },
          plugins: {
            tooltip: {
              callbacks: {
                title: function(tooltipItems) {
                  return tooltipItems[0].label;
                },
                label: function(context) {
                  if (context.datasetIndex === 0) {
                    const percent = (context.raw / columnData.length * 100).toFixed(1);
                    return `頻度: ${context.raw} (${percent}%)`;
                  } else {
                    return `正規分布: ${context.raw.toFixed(2)}`;
                  }
                }
              }
            },
            legend: {
              position: 'top',
              labels: {
                boxWidth: 12,
                padding: 10
              }
            },
            // 管理限界線とシグマラインのためのアノテーション
            annotation: {
              annotations: {
                // 中心線 (CL)
                centerLine: {
                  type: 'line',
                  xMin: clVal,
                  xMax: clVal,
                  borderColor: 'rgba(0, 0, 0, 0.8)',
                  borderWidth: 2,
                  label: {
                    display: true,
                    content: `CL: ${clVal.toFixed(2)}`,
                    position: 'start',
                    backgroundColor: 'rgba(0, 0, 0, 0.8)'
                  }
                },
                // 上側管理限界 (UCL)
                ucl: {
                  type: 'line',
                  xMin: uclVal,
                  xMax: uclVal,
                  borderColor: 'rgba(231, 76, 60, 0.8)',
                  borderWidth: 2,
                  borderDash: [6, 4],
                  label: {
                    display: true,
                    content: `UCL: ${uclVal.toFixed(2)}`,
                    position: 'start',
                    backgroundColor: 'rgba(231, 76, 60, 0.8)'
                  }
                },
                // 下側管理限界 (LCL)
                lcl: {
                  type: 'line',
                  xMin: lclVal,
                  xMax: lclVal,
                  borderColor: 'rgba(231, 76, 60, 0.8)',
                  borderWidth: 2,
                  borderDash: [6, 4],
                  label: {
                    display: true,
                    content: `LCL: ${lclVal.toFixed(2)}`,
                    position: 'start',
                    backgroundColor: 'rgba(231, 76, 60, 0.8)'
                  }
                },
                // +1σライン（表示する場合のみ）
                sigmaPlusOne: {
                  type: 'line',
                  xMin: sigmaPlusOne,
                  xMax: sigmaPlusOne,
                  borderColor: 'rgba(52, 152, 219, 0.6)',
                  borderWidth: 1,
                  borderDash: [3, 3],
                  display: state.controlLimits.showSigmaLines,
                  label: {
                    display: state.controlLimits.showSigmaLines,
                    content: `+1σ: ${sigmaPlusOne.toFixed(2)}`,
                    position: 'start',
                    backgroundColor: 'rgba(52, 152, 219, 0.6)'
                  }
                },
                // +2σライン（表示する場合のみ）
                sigmaPlusTwo: {
                  type: 'line',
                  xMin: sigmaPlusTwo,
                  xMax: sigmaPlusTwo,
                  borderColor: 'rgba(52, 152, 219, 0.6)',
                  borderWidth: 1,
                  borderDash: [3, 3],
                  display: state.controlLimits.showSigmaLines,
                  label: {
                    display: state.controlLimits.showSigmaLines,
                    content: `+2σ: ${sigmaPlusTwo.toFixed(2)}`,
                    position: 'start',
                    backgroundColor: 'rgba(52, 152, 219, 0.6)'
                  }
                },
                // -1σライン（表示する場合のみ）
                sigmaMinusOne: {
                  type: 'line',
                  xMin: sigmaMinusOne,
                  xMax: sigmaMinusOne,
                  borderColor: 'rgba(52, 152, 219, 0.6)',
                  borderWidth: 1,
                  borderDash: [3, 3],
                  display: state.controlLimits.showSigmaLines,
                  label: {
                    display: state.controlLimits.showSigmaLines,
                    content: `-1σ: ${sigmaMinusOne.toFixed(2)}`,
                    position: 'start',
                    backgroundColor: 'rgba(52, 152, 219, 0.6)'
                  }
                },
                // -2σライン（表示する場合のみ）
                sigmaMinusTwo: {
                  type: 'line',
                  xMin: sigmaMinusTwo,
                  xMax: sigmaMinusTwo,
                  borderColor: 'rgba(52, 152, 219, 0.6)',
                  borderWidth: 1,
                  borderDash: [3, 3],
                  display: state.controlLimits.showSigmaLines,
                  label: {
                    display: state.controlLimits.showSigmaLines,
                    content: `-2σ: ${sigmaMinusTwo.toFixed(2)}`,
                    position: 'start',
                    backgroundColor: 'rgba(52, 152, 219, 0.6)'
                  }
                }
              }
            }
          },
          scales: {
            x: {
              title: {
                display: true,
                text: state.selectedColumn,
                font: {
                  weight: 'bold',
                  size: 12
                },
                padding: {
                  top: 10
                }
              },
              min: state.xAxisRange.displayMin,
              max: state.xAxisRange.displayMax,
              ticks: {
                // 十分な幅がある場合は横書き、そうでない場合は回転
                maxRotation: checkLabelOverlap(labels, canvas.width) ? 90 : 0,
                minRotation: checkLabelOverlap(labels, canvas.width) ? 90 : 0,
                font: {
                  size: 10
                }
              }
            },
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: '頻度',
                font: {
                  weight: 'bold',
                  size: 12
                }
              },
              ticks: {
                font: {
                  size: 10
                }
              }
            }
          }
        }
      });
      
      // ビジュアライゼーションタイトルを更新
      visualizationTitle.textContent = `${state.selectedColumn} のヒストグラム`;
      
      // コントロールを表示
      chartControls.style.display = 'flex';
      
      // 統計情報を表示
      updateStatisticsDisplay(stats);
      
      // 処理完了
      setProcessing(false);
      
      // 成功通知
      showNotification('ヒストグラム生成完了', 'ヒストグラムを正常に生成しました');
    }, 500); // 処理時間の視覚的フィードバックのため少し遅延
  }

  /**
   * 正規分布のデータポイントを計算する
   * @param {Array<number>} data - 元データ
   * @param {number} min - 最小値
   * @param {number} max - 最大値
   * @param {number} bins - ビン数
   * @param {number} mean - 平均値
   * @param {number} stdDev - 標準偏差
   * @return {Array<number>} 正規分布のデータポイント
   */
  function calculateNormalDistribution(data, min, max, bins, mean, stdDev) {
    // ビンの幅を計算
    const range = max - min;
    const binWidth = range / bins;
    
    // 正規分布のデータポイントを計算
    const normalDistPoints = [];
    
    for (let i = 0; i < bins; i++) {
      const x = min + (i + 0.5) * binWidth; // ビンの中央値
      
      // 正規分布の確率密度関数
      const normalValue = (1 / (stdDev * Math.sqrt(2 * Math.PI))) * 
        Math.exp(-0.5 * Math.pow((x - mean) / stdDev, 2));
      
      // データの総数とビン幅でスケーリング
      const scaledValue = normalValue * data.length * binWidth;
      normalDistPoints.push(scaledValue);
    }
    
    return normalDistPoints;
  }

  /**
   * 統計情報を計算する
   * @param {Array<number>} data - 計算対象のデータ
   * @return {Object} 統計情報オブジェクト
   */
  function calculateStatistics(data) {
    // データ数
    const count = data.length;
    
    // 合計
    const sum = data.reduce((acc, val) => acc + val, 0);
    
    // 平均値
    const mean = sum / count;
    
    // 分散
    const variance = data.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / count;
    
    // 標準偏差
    const stdDev = Math.sqrt(variance);
    
    // 最小値と最大値
    const min = Math.min(...data);
    const max = Math.max(...data);
    
    // ソートされたデータ
    const sortedData = [...data].sort((a, b) => a - b);
    
    // 中央値
    let median;
    if (count % 2 === 0) {
      median = (sortedData[count / 2 - 1] + sortedData[count / 2]) / 2;
    } else {
      median = sortedData[Math.floor(count / 2)];
    }
    
    // 四分位数
    const q1Index = Math.floor(count * 0.25);
    const q3Index = Math.floor(count * 0.75);
    const q1 = sortedData[q1Index];
    const q3 = sortedData[q3Index];
    
    // 四分位範囲
    const iqr = q3 - q1;
    
    // 歪度
    const skewness = data.reduce((acc, val) => acc + Math.pow((val - mean) / stdDev, 3), 0) / count;
    
    // 尖度（超過尖度）
    const kurtosis = data.reduce((acc, val) => acc + Math.pow((val - mean) / stdDev, 4), 0) / count - 3;
    
    return {
      count,
      sum,
      mean,
      median,
      stdDev,
      variance,
      min,
      max,
      q1,
      q3,
      iqr,
      skewness,
      kurtosis
    };
  }

  /**
   * 標準偏差を計算する
   * @param {Array<number>} data - 計算対象のデータ
   * @return {number} 標準偏差
   */
  function calculateStandardDeviation(data) {
    const n = data.length;
    const mean = data.reduce((a, b) => a + b, 0) / n;
    const variance = data.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
    return Math.sqrt(variance);
  }

  /**
   * 統計情報の表示を更新する
   * @param {Object} stats - 統計情報オブジェクト
   */
  function updateStatisticsDisplay(stats) {
    // 基本統計値を更新
    dataCount.textContent = stats.count.toLocaleString();
    mean.textContent = stats.mean.toFixed(2);
    median.textContent = stats.median.toFixed(2);
    stdDev.textContent = stats.stdDev.toFixed(2);
    minValue.textContent = stats.min.toFixed(2);
    maxValue.textContent = stats.max.toFixed(2);
    kurtosis.textContent = stats.kurtosis.toFixed(2);
    skewness.textContent = stats.skewness.toFixed(2);
    
    // 分布タイプを判定
    let distType = '';
    
    // 歪度による判定
    if (Math.abs(stats.skewness) < 0.5) {
      distType = '対称分布';
      
      // 尖度による分布タイプの詳細
      if (stats.kurtosis < -0.5) {
        distType += ' (平坦型)';
      } else if (stats.kurtosis > 0.5) {
        distType += ' (尖鋭型)';
      } else {
        distType += ' (正規分布に近い)';
      }
    } else if (stats.skewness > 0) {
      distType = stats.skewness > 1 ? '強い右裾型分布' : '右裾型分布';
    } else {
      distType = stats.skewness < -1 ? '強い左裾型分布' : '左裾型分布';
    }
    
    distributionTypeText.textContent = distType;
    distributionInfo.style.display = 'block';
  }

  /**
   * ヒストグラムを画像としてダウンロードする
   */
  function downloadHistogram() {
    if (!state.chart) return;
    
    const canvas = state.chart.canvas;
    
    // canvas を画像に変換
    const image = canvas.toDataURL('image/png');
    
    // ダウンロードリンクを作成
    const link = document.createElement('a');
    link.download = `histogram_${state.selectedColumn}.png`;
    link.href = image;
    
    // リンクをクリックしてダウンロード
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showNotification('ダウンロード完了', 'ヒストグラムの画像をダウンロードしました');
  }

  /**
   * 統計情報をCSVとしてエクスポートする
   */
  function exportStatistics() {
    if (!state.statistics) return;
    
    const stats = state.statistics;
    
    // CSVヘッダー
    let csvContent = 'メトリクス,値\n';
    
    // 統計情報を追加
    csvContent += `カラム名,${state.selectedColumn}\n`;
    csvContent += `データ数,${stats.count}\n`;
    csvContent += `最小値,${stats.min}\n`;
    csvContent += `最大値,${stats.max}\n`;
    csvContent += `平均値,${stats.mean}\n`;
    csvContent += `中央値,${stats.median}\n`;
    csvContent += `標準偏差,${stats.stdDev}\n`;
    csvContent += `分散,${stats.variance}\n`;
    csvContent += `第1四分位数,${stats.q1}\n`;
    csvContent += `第3四分位数,${stats.q3}\n`;
    csvContent += `四分位範囲,${stats.iqr}\n`;
    csvContent += `歪度,${stats.skewness}\n`;
    csvContent += `尖度,${stats.kurtosis}\n`;
    csvContent += `合計,${stats.sum}\n`;
    
    // フィルターが適用されている場合はその情報も追加
    if (state.activeFilters) {
      csvContent += `\nフィルター適用,はい\n`;
      csvContent += `元データ数,${state.originalData.length}\n`;
      csvContent += `フィルター後データ数,${state.csvData.length}\n`;
      
      state.filters.forEach((filter, index) => {
        if (filter.column && filter.operator && filter.value !== '') {
          csvContent += `フィルター${index + 1},${filter.column} ${filter.operator} ${filter.value}\n`;
        }
      });
    }
    
    // 管理限界線の情報を追加
    csvContent += `\n中心線(CL),${parseFloat(clValue.value) || state.controlLimits.cl}\n`;
    csvContent += `上側管理限界(UCL),${parseFloat(uclValue.value) || state.controlLimits.ucl}\n`;
    csvContent += `下側管理限界(LCL),${parseFloat(lclValue.value) || state.controlLimits.lcl}\n`;
    
    // Blob を作成
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    
    // ダウンロードリンクを作成
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `statistics_${state.selectedColumn}.csv`;
    
    // リンクをクリックしてダウンロード
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showNotification('エクスポート完了', '統計情報をCSVとしてエクスポートしました');
  }

  /**
   * アプリケーションの状態をリセットする
   */
  function resetApplication() {
    // データをクリア
    state.csvData = null;
    state.originalData = null;
    state.columns = [];
    state.numericColumns = [];
    state.categoricalColumns = [];
    state.selectedColumn = '';
    state.filters = [];
    state.activeFilters = false;
    
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
    
    // UIをリセット
    clearFileInfo();
    fileInput.value = '';
    
    // ヒストグラムコントロールを非表示
    histogramControls.style.display = 'none';
    
    // フィルターコントロールを非表示
    filterControls.style.display = 'none';
    
    // カラム選択肢をリセット
    dataColumn.innerHTML = '<option value="">CSV取り込み後に選択可能になります</option>';
    dataColumn.disabled = true;
    
    // カラースキーム選択をリセット
    colorScheme.disabled = true;
    
    // ビン数設定をリセット
    binMethod.value = 'sturges';
    state.binMethodValue = 'sturges';
    customBinSettings.style.display = 'none';
    
    // 管理限界線をリセット
    clValue.value = '';
    uclValue.value = '';
    lclValue.value = '';
    state.controlLimits.cl = null;
    state.controlLimits.ucl = null;
    state.controlLimits.lcl = null;
    showSigmaLines.checked = true;
    state.controlLimits.showSigmaLines = true;
    
    // X軸表示範囲をリセット
    xAxisZoom.value = 1;
    xAxisZoomValue.textContent = '1';
    state.xAxisZoom.factor = 1;
    state.xAxisZoom.center = null;
    state.xAxisZoom.min = null;
    state.xAxisZoom.max = null;
    
    // X軸MIN/MAX範囲をリセット
    minRangeSlider.value = 0;
    maxRangeSlider.value = 100;
    minRangeValue.textContent = '-';
    maxRangeValue.textContent = '-';
    state.xAxisRange.dataMin = null;
    state.xAxisRange.dataMax = null;
    state.xAxisRange.displayMin = null;
    state.xAxisRange.displayMax = null;
    
    // 生成ボタンを無効化
    generateBtn.disabled = true;
    
    // コントロールを非表示
    chartControls.style.display = 'none';
    
    // ヒストグラムをリセット
    histogram.innerHTML = '';
    
    // プレースホルダーを表示
    placeholder.style.display = 'flex';
    
    // 統計情報を非表示
    distributionInfo.style.display = 'none';
    
    // ビジュアライゼーションタイトルをリセット
    visualizationTitle.textContent = 'データ可視化';
    
    // アラートをクリア
    alertContainer.innerHTML = '';
  }
  
  /**
   * X軸の表示範囲を更新する
   * @param {boolean} [updateChart=true] - チャートを更新するかどうか
   */
  function updateXAxisRange(updateChart = true) {
    if (!state.statistics) return;
    
    // 現在のズーム倍率を取得
    const zoomFactor = state.xAxisZoom.factor;
    
    // データの範囲を取得
    const dataMin = state.statistics.min;
    const dataMax = state.statistics.max;
    const dataRange = dataMax - dataMin;
    
    // ズーム中心値がない場合はデータの中心を使用
    if (state.xAxisZoom.center === null) {
      state.xAxisZoom.center = (dataMin + dataMax) / 2;
    }
    
    // 表示範囲を計算
    const visibleRange = dataRange / zoomFactor;
    const halfRange = visibleRange / 2;
    const center = state.xAxisZoom.center;
    
    // 最小値と最大値を計算
    let minValue = center - halfRange;
    let maxValue = center + halfRange;
    
    // 範囲がデータ全体を超えないように調整
    if (minValue < dataMin) {
      minValue = dataMin;
      maxValue = dataMin + visibleRange;
      if (maxValue > dataMax) maxValue = dataMax;
    }
    
    if (maxValue > dataMax) {
      maxValue = dataMax;
      minValue = dataMax - visibleRange;
      if (minValue < dataMin) minValue = dataMin;
    }
    
    // 状態を更新
    state.xAxisZoom.min = minValue;
    state.xAxisZoom.max = maxValue;
    
    // チャートがあり、更新フラグがtrueの場合はチャートを更新
    if (state.chart && updateChart) {
      state.chart.options.scales.x.min = minValue;
      state.chart.options.scales.x.max = maxValue;
      state.chart.update();
    }
  }

  // イベントリスナー

  // ドラッグ＆ドロップ関連
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, e => {
      e.preventDefault();
      e.stopPropagation();
    }, false);
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => {
      dropArea.classList.add('highlight');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => {
      dropArea.classList.remove('highlight');
    }, false);
  });

  // ファイルドロップイベント
  dropArea.addEventListener('drop', e => {
    const file = e.dataTransfer.files[0];
    if (!file) return;
    
    // ファイル形式チェック
    const fileExtension = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'xls', 'xlsx'].includes(fileExtension)) {
      showAlert('warning', 'CSVまたはExcelファイル形式(XLS, XLSX)のみ対応しています。', 5000);
      return;
    }
    
    // ファイルサイズチェック (最大10MB)
    if (file.size > 10 * 1024 * 1024) {
      showAlert('warning', 'ファイルサイズが大きすぎます (最大10MB)。', 5000);
      return;
    }
    
    // アプリケーションをリセット
    resetApplication();
    
    // ファイル処理
    processFile(file);
  }, false);

  // ファイル選択イベント
  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    
    // ファイル形式チェック
    const fileExtension = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'xls', 'xlsx'].includes(fileExtension)) {
      showAlert('warning', 'CSVまたはExcelファイル形式(XLS, XLSX)のみ対応しています。', 5000);
      e.target.value = ''; // 入力をクリア
      return;
    }
    
    // ファイルサイズチェック (最大10MB)
    if (file.size > 10 * 1024 * 1024) {
      showAlert('warning', 'ファイルサイズが大きすぎます (最大10MB)。', 5000);
      e.target.value = ''; // 入力をクリア
      return;
    }
    
    // アプリケーションをリセット
    resetApplication();
    
    // ファイル処理
    processFile(file);
  });

  // ファイル削除ボタン
  removeFile.addEventListener('click', () => {
    resetApplication();
    showAlert('info', 'ファイルを削除しました。新しいCSVファイルをアップロードしてください。', 3000);
  });

  /**
   * データカラム選択イベント
   */
  dataColumn.addEventListener('change', () => {
    state.selectedColumn = dataColumn.value;
    generateBtn.disabled = state.selectedColumn === '';
    
    // 選択されたカラムがある場合、フィルターコントロールを表示
    if (state.selectedColumn !== '') {
      filterControls.style.display = 'block';
      
      // フィルターUIを作成
      createFilterUI();
    } else {
      filterControls.style.display = 'none';
    }
  });

  /**
   * 階級設定方法変更イベント
   */
  binMethod.addEventListener('change', () => {
    state.binMethodValue = binMethod.value;
    
    if (binMethod.value === 'custom') {
      customBinSettings.style.display = 'block';
    } else {
      customBinSettings.style.display = 'none';
    }
  });

  /**
   * ビン数変更イベント
   */
  binCount.addEventListener('input', () => {
    state.binCountValue = parseInt(binCount.value, 10);
    binCountValue.textContent = binCount.value;
  });

  /**
   * カラースキーム変更イベント
   */
  colorScheme.addEventListener('change', () => {
    state.colorSchemeValue = colorScheme.value;
  });
  
  /**
   * X軸表示範囲コントロール用のイベントリスナー
   */
  xAxisZoom.addEventListener('input', () => {
    state.xAxisZoom.factor = parseFloat(xAxisZoom.value);
    xAxisZoomValue.textContent = xAxisZoom.value;
    
    if (state.chart) {
      updateXAxisRange();
    }
  });
  
  /**
   * X軸MIN/MAX範囲スライダーのイベントリスナー
   */
  minRangeSlider.addEventListener('input', () => {
    // 最小値が最大値より大きくならないように調整
    if (parseInt(minRangeSlider.value) >= parseInt(maxRangeSlider.value)) {
      minRangeSlider.value = parseInt(maxRangeSlider.value) - 1;
    }
    
    // スライダートラックを更新
    updateRangeSliderTrack();
  });
  
  maxRangeSlider.addEventListener('input', () => {
    // 最大値が最小値より小さくならないように調整
    if (parseInt(maxRangeSlider.value) <= parseInt(minRangeSlider.value)) {
      maxRangeSlider.value = parseInt(minRangeSlider.value) + 1;
    }
    
    // スライダートラックを更新
    updateRangeSliderTrack();
  });

  /**
   * 3σラインの表示切替イベント
   */
  showSigmaLines.addEventListener('change', () => {
    state.controlLimits.showSigmaLines = showSigmaLines.checked;
    
    // チャートが既に表示されている場合は再描画
    if (state.chart) {
      generateHistogram();
    }
  });

  /**
   * 管理限界線のリセットボタンのイベント
   */
  resetCL.addEventListener('click', () => {
    if (state.statistics) {
      clValue.value = state.statistics.mean.toFixed(2);
      // UCLとLCLも自動的に更新
      uclValue.value = (state.statistics.mean + (3 * state.statistics.stdDev)).toFixed(2);
      lclValue.value = (state.statistics.mean - (3 * state.statistics.stdDev)).toFixed(2);
      
      // チャートが既に表示されている場合は再描画
      if (state.chart) {
        generateHistogram();
      }
    }
  });

  resetUCL.addEventListener('click', () => {
    if (state.statistics) {
      const cl = parseFloat(clValue.value) || state.statistics.mean;
      uclValue.value = (cl + (3 * state.statistics.stdDev)).toFixed(2);
      
      // チャートが既に表示されている場合は再描画
      if (state.chart) {
        generateHistogram();
      }
    }
  });

  resetLCL.addEventListener('click', () => {
    if (state.statistics) {
      const cl = parseFloat(clValue.value) || state.statistics.mean;
      lclValue.value = (cl - (3 * state.statistics.stdDev)).toFixed(2);
      
      // チャートが既に表示されている場合は再描画
      if (state.chart) {
        generateHistogram();
      }
    }
  });

  /**
   * 管理限界値変更時の再描画
   */
  [clValue, uclValue, lclValue].forEach(input => {
    input.addEventListener('change', () => {
      if (state.chart) {
        generateHistogram();
      }
    });
  });

  /**
   * ヒストグラム生成ボタンイベント
   */
  generateBtn.addEventListener('click', generateHistogram);

  /**
   * フィルター適用ボタンイベント
   */
  applyFilterBtn.addEventListener('click', () => {
    // フィルターを適用
    applyFilters();
    
    // ヒストグラムが表示されている場合は再描画
    if (state.chart) {
      generateHistogram();
    }
  });

  // ダウンロードボタン
  downloadBtn.addEventListener('click', downloadHistogram);

  // エクスポートボタン
  exportBtn.addEventListener('click', exportStatistics);

  // ウィンドウリサイズイベント - チャートのレスポンシブ対応
  window.addEventListener('resize', () => {
    if (state.chart) {
      state.chart.resize();
    }
  });

  // Chart.jsのアノテーションプラグインは既にCDNで読み込み済み
});