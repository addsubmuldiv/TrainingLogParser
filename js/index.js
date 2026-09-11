
function readFile(file) {
    let reader = new FileReader();
    reader.onload = (function (file) {
        return function (e) {
            logParser.addFile(file.name.trim(), e.target.result)
        }
    })(file);
    reader.readAsText(file);
}


function selectFile(evt) {
    if (evt.target.files.length > 0) {
        readFile(evt.target.files[0])
    }
}

function dropHandler(event) {
    event.preventDefault();
    if (event.dataTransfer.items) {
        [...event.dataTransfer.items].forEach((item, i) => {
            if (item.kind === 'file') {
                readFile(item.getAsFile());
            }
        });
    }
}

function dragoverHandler(event) {
    event.preventDefault();
}

function settingClickHandler(fileName) {
    let dialog = document.getElementById('dialogDiv');
    if (typeof dialog.showModal === "function") {
        document.getElementById('dialogTitle').innerText = fileName;

        let context = ''
        for(let parseKey in logParser.files[fileName].keyDatas){
            let keyData = logParser.files[fileName].keyDatas[parseKey]
            context = context + `[${parseKey}] ${keyData.parsedData.length} times, ${keyData.dataNoZero.length} times(without zeros/neg.)\n`
        }

        document.getElementById('dialogContext').innerText = context.trim()
        document.getElementById('parserKeyText').value = logParser.files[fileName].dataKeysString;

        let end = logParser.files[fileName].rangeEnd
        document.getElementById('lossRangeText').value = logParser.files[fileName].rangeStart + ':' + end;

        // remove all event listener
        let old_element = document.getElementById("dialogDownloadCSV");
        let new_element = old_element.cloneNode(true);
        old_element.parentNode.replaceChild(new_element, old_element);
        document.getElementById('dialogDownloadCSV').addEventListener('click', function (e) {
            logParser.downloadCSV(fileName);
        })
        dialog.showModal();
    }
}

function removeLogClickHandler(fileName) {
    logParser.removeFile(fileName);
}

function dialogButtonHandler(event) {
    document.getElementById('dialogDiv').close();
    logParser.setFileSetting(
        document.getElementById('dialogTitle').innerText,
        document.getElementById('parserKeyText').value,
        document.getElementById('lossRangeText').value,
        document.getElementById('regex').checked
    );
}

function checkboxClickHandler(event){
    logParser.updateFileVisible(event.name, event.checked)
}

function comparisonRadioHandler(comparisonType) {
    logParser.updateComparisonType(comparisonType)
}

class LogParser {
    constructor() {
        this.files = {};
        this.cookies = {};
        this.defaultParseKeys = 'loss:';
        this.comparisonType = 'normal';
        this.reverseComparison = false;
        this.relative_baseline = 0.02;
        this.baselineFileName = null;

        let cookies = document.cookie.split(';');
        for (let i in cookies) {
            let cookie = cookies[i].split('=', 2);
            if (cookie !== undefined && cookie.length > 1) {
                this.cookies[cookie[0].trim()] = cookie[1];
            }
        }

        this.globalParseKey = this.cookies['globalParseKey'] || '';
        this.maxGlobalParseKeyHistory = 10;
        try {
            this.globalParseKeys = JSON.parse(this.cookies['globalParseKeys'] || '[]');
            if (!Array.isArray(this.globalParseKeys)) {
                this.globalParseKeys = [];
            }
            this.globalParseKeys = this.globalParseKeys.slice(0, this.maxGlobalParseKeyHistory);
        } catch (e) {
            this.globalParseKeys = [];
        }
    }

    addFile(fileName, fileText) {
        if (!(fileName in this.files)) {
            this.files[fileName] = new FileData(fileName, fileText);
            this.files[fileName].visible = true;
            addFileDiv(fileName, this.files[fileName])
        }else{
            this.files[fileName].updateFileText(fileName, fileText);
            this.files[fileName].visible = true;
        }
        this.files[fileName].updateKeys(this.getInitParseKeys(fileName));
        this.updateChart();
    }

    updateFileVisible(fileName, visible){
        if(fileName === this.baselineFileName){
            this.files[fileName].visible = true;
        }else{
            this.files[fileName].visible = visible;
        }
        this.updateChart();
    }

    setBaseline(fileName){
        if(!(fileName in this.files)){
            return;
        }

        if(this.baselineFileName === fileName){
            this.baselineFileName = null;
        }else{
            this.baselineFileName = fileName;
            this.files[fileName].visible = true;
        }

        this.updateChart();
    }

    updateBaselineUI(){
        for(let fileName in this.files){
            let checkboxDiv = document.getElementById("selectLog_" + fileName);
            if(checkboxDiv == null){
                continue;
            }

            let checkbox = checkboxDiv.querySelector('input[type=checkbox]');
            if(fileName === this.baselineFileName){
                checkboxDiv.classList.add("baseline");
                if(checkbox != null){
                    checkbox.checked = true;
                    checkbox.title = "Baseline";
                }
            }else{
                checkboxDiv.classList.remove("baseline");
                if(checkbox != null){
                    checkbox.title = "";
                }
            }
        }
    }

    getInitParseKeys(fileName){
        let keys;
        let globalParseKey = getGlobalParseKey();
        let autoIdent = this.files[fileName].autoIdentificationFramework();
        if (globalParseKey !== ''){
            keys = globalParseKey
        }else if(fileName in this.cookies){
            keys = this.cookies[fileName];
        }else if(autoIdent !== null){
            keys = autoIdent;
        }else{
            keys = this.defaultParseKeys;
        }
        this.cookies[fileName] = keys;
        return keys;
    }

    setGlobalLossTag(keys){
        this.globalParseKey = keys;
        for(let key in this.files){
            this.files[key].updateKeys(keys)
        }
        this.updateChart();
    }

    addGlobalParseKeyHistory(keys){
        this.globalParseKey = keys;
        this.cookies['globalParseKey'] = keys;

        if (keys === '' || this.isDefaultGlobalParseKey(keys)){
            return;
        }

        this.globalParseKeys = this.globalParseKeys.filter(item => item !== keys);
        this.globalParseKeys.unshift(keys);
        if (this.globalParseKeys.length > this.maxGlobalParseKeyHistory){
            this.globalParseKeys = this.globalParseKeys.slice(0, this.maxGlobalParseKeyHistory);
        }

        this.cookies['globalParseKeys'] = JSON.stringify(this.globalParseKeys);
        this.updateGlobalParseKeyOptions();
    }

    isDefaultGlobalParseKey(keys){
        let datalist = document.getElementById('globalParseKey');
        if (!datalist){
            return false;
        }

        let defaultOptions = datalist.querySelectorAll('option:not(.history-global-parse-key)');
        for(let option of defaultOptions){
            if (option.value === keys){
                return true;
            }
        }
        return false;
    }

    migrateGlobalParseKeyHistory(){
        this.globalParseKeys = this.globalParseKeys.filter(key => !this.isDefaultGlobalParseKey(key));
        this.cookies['globalParseKeys'] = JSON.stringify(this.globalParseKeys);

        if (this.globalParseKey === ''){
            return;
        }
        if (this.globalParseKeys.indexOf(this.globalParseKey) !== -1){
            return;
        }
        if (this.isDefaultGlobalParseKey(this.globalParseKey)){
            return;
        }

        this.globalParseKeys.unshift(this.globalParseKey);
        if (this.globalParseKeys.length > this.maxGlobalParseKeyHistory){
            this.globalParseKeys = this.globalParseKeys.slice(0, this.maxGlobalParseKeyHistory);
        }
        this.cookies['globalParseKeys'] = JSON.stringify(this.globalParseKeys);
    }

    updateGlobalParseKeyOptions(){
        let datalist = document.getElementById('globalParseKey');
        if (!datalist){
            return;
        }

        this.migrateGlobalParseKeyHistory();

        datalist.querySelectorAll('option.history-global-parse-key').forEach(option => option.remove());
        for(let key of this.globalParseKeys){
            let option = document.createElement('option');
            option.value = key;
            option.textContent = key;
            option.classList.add('history-global-parse-key');
            datalist.appendChild(option);
        }
    }

    setFileSetting(fileName, parseKeys, rangeTag, regex){
        let file = this.files[fileName];
        file.updateKeys(parseKeys, regex);
        let range = rangeTag.split(":");
        file.setDataRange(parseInt(range[0]), parseInt(range[1]));
        this.updateChart();
    }

    processComparisonData(){
        let comparisonEntries = [];

        if (isDisableComparison()){
            return comparisonEntries;
        }

        let visibleFiles = [];
        for(let fileName in this.files){
            if(this.files[fileName].visible){
                visibleFiles.push(this.files[fileName]);
            }
        }

        if(visibleFiles.length < 2){
            return comparisonEntries;
        }

        visibleFiles.sort((a, b) => a.fileName.localeCompare(b.fileName));

        let comparisonStep = getComparisonStep();
        let noZero = isNoZero();

        if(this.baselineFileName != null && (this.baselineFileName in this.files)){
            let baselineFile = this.files[this.baselineFileName];
            for(let targetFile of visibleFiles){
                if(targetFile.fileName === baselineFile.fileName){
                    continue;
                }

                let file1 = targetFile;
                let file2 = baselineFile;
                if(this.reverseComparison){
                    file1 = baselineFile;
                    file2 = targetFile;
                }

                let keyLength = Math.min(baselineFile.parsedKeys.length, targetFile.parsedKeys.length);
                for(let index=0; index<keyLength; index++){
                    comparisonEntries.push({
                        keyIndex: index,
                        file1Name: file1.fileName,
                        file2Name: file2.fileName,
                        baselineFileName: baselineFile.fileName,
                        isBaseline: true,
                        comparisonData: new ComparisonData(
                            file1.keyDatas[file1.parsedKeys[index]],
                            file2.keyDatas[file2.parsedKeys[index]],
                            comparisonStep, this.relative_baseline, noZero
                        )
                    });
                }
            }
            return comparisonEntries;
        }

        if(visibleFiles.length === 2){
            visibleFiles.sort((a, b) => a.fileName.localeCompare(b.fileName));
            if(this.reverseComparison){
                visibleFiles.reverse();
            }

            let keyLength = Math.min(visibleFiles[0].parsedKeys.length, visibleFiles[1].parsedKeys.length);
            for(let index=0; index<keyLength; index++){
                comparisonEntries.push({
                    keyIndex: index,
                    file1Name: visibleFiles[0].fileName,
                    file2Name: visibleFiles[1].fileName,
                    baselineFileName: null,
                    isBaseline: false,
                    comparisonData: new ComparisonData(
                        visibleFiles[0].keyDatas[visibleFiles[0].parsedKeys[index]],
                        visibleFiles[1].keyDatas[visibleFiles[1].parsedKeys[index]],
                        comparisonStep, this.relative_baseline, noZero
                    )
                });
            }
        }

        return comparisonEntries;
    }

    updateComparisonType(comparisonType){
        if (this.comparisonType !== comparisonType){
            this.reverseComparison = false;
        }else{
            this.reverseComparison = !this.reverseComparison
        }
        this.comparisonType = comparisonType;
        this.updateChart();
    }

    updateChart(){
        this.updateBaselineUI();
        updateParseKeyChart(this.files);
        let comparisonDatas = this.processComparisonData();
        if(comparisonDatas.length > 0){
            updateComparisonChart(comparisonDatas, this.comparisonType);
        }
        this.saveParseKeysToCookie();
    }

    removeFile(fileName) {
        if(fileName in this.files) {
            document.getElementById("selectLog_" + fileName).remove();
            delete this.files[fileName]
            if(this.baselineFileName === fileName){
                this.baselineFileName = null;
            }
            clearDataMaxMinMean();
            this.updateChart();
        }
    }

    saveParseKeysToCookie() {
        for(let fileName in this.files){
            this.cookies[fileName] = this.files[fileName].dataKeysString;
        }

        for (let cookie in this.cookies) {
            if (window.location.hostname === 'openx.huawei.com') {
                document.cookie = cookie + "=" + this.cookies[cookie] + ";path=/project/1738";
            } else {
                document.cookie = cookie + "=" + this.cookies[cookie] + ";path=/";
            }
        }
    }

    downloadCSV(fileName) {
        let csvContent = 'data:text/csv;charset=utf-8,' + this.files[fileName].getCSVContext();
        let link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", fileName + '.csv');
        link.click();
    }
}


logParser = new LogParser();

