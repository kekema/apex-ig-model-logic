window.lib4x = window.lib4x || {};
window.lib4x.axt = window.lib4x.axt || {};
window.lib4x.axt.ig = window.lib4x.axt.ig || {};

/*
 * IG Model Logic plugin provides a convenience layer on top of APEX model, in particular as used for IGs,
 * by offering 'event' handlers: onEvaluateRecord, onFieldChange, onSetAggregateValue, onInitCalcValue, onInitCheckCallback
 * and a set of util methods especially for dealing with record(field)metadata.
 * By this, a model (business) logic layer can be established. Whereas the native APEX model notifications are 
 * more like messaging deltas from the model to the view(s), the above event handlers are having
 * application-level semantics and are expressive for business logic rather than infrastructure.
 */
lib4x.axt.ig.modelLogic = (function ($) {

    // event handlers by ig static id
    let ig_ml_eventHandlers = {};    
    // per-record + per-field suppression flag map to support 'suppressFieldChangeHandler'
    let suppressionMap = new WeakMap();
    // region id property name as depending on the APEX version (regionStaticId/regionDomId)
    let regionIdPropertyName;

    // modelLogic util methods
    let modelUtil = {
        getOriginalRecord: function(model, recordId)
        {
            let recordMetadata = model.getRecordMetadata(recordId);
            return recordMetadata?.original;
        },
        setRecordHighlight: function(model, recordId, hlClass = null)
        {
            let recordMetadata = model.getRecordMetadata(recordId);
            let hlCurrentValue = recordMetadata.highlight;
            // don't interfere with user set highlighting
            if (hlClass !== hlCurrentValue && !util.isUserHighlight(hlCurrentValue))
            {        
                recordMetadata.highlight = hlClass;    
                model.metadataChanged(recordId, null, 'highlight');
            }
        },
        setRecordDisabled: function(model, recordId, disabled)
        {
            model.setDisabledState(recordId, disabled);
        },
        setRecordHidden: function(model, recordId, hidden)
        {
            model.setHiddenState(recordId, hidden);
        },        
        setRecordError: function(model, recordId, message = '')
        {
            _modelUtil.setRecordMessage(model, recordId, 'error', message);
        }, 
        setRecordWarning: function(model, recordId, message = '')
        {
            _modelUtil.setRecordMessage(model, recordId, 'warning', message);
        },   
        recordHasError: function(model, recordId)
        {
            let recordMetadata = model.getRecordMetadata(recordId);
            return (recordMetadata.error === true);            
        },
        recordHasWarning: function(model, recordId)
        {
            let recordMetadata = model.getRecordMetadata(recordId);
            return (recordMetadata.warning === true);            
        }, 
        // recordIsValid: will check for any error on both record and field level
        recordIsValid: function(model, recordId)
        {
            let recMetaData = model.getRecordMetadata(recordId);
            return (!recMetaData?.error && _modelUtil.recordFieldsValid(model, recordId));
        },    
        // getRecordStatus : 'original', 'changed', 'new+changed' or 'deleted'      
        getRecordStatus: function(model, recordId)
        {
            let recordStatus = 'original';
            let recordMetadata = model.getRecordMetadata(recordId);
            if (recordMetadata.deleted === true)
            {
                recordStatus = 'deleted';
            }
            else if (recordMetadata.inserted === true)
            {
                recordStatus = recordMetadata.updated === true ? 'new+changed' : 'new';
            }
            else if (recordMetadata.updated === true)
            {
                recordStatus = 'changed';
            }
            return recordStatus;
        }, 
        // recordIsNew
        // a new record can also be updated
        recordIsNew: function(model, recordId)
        {
            let recordMetadata = model.getRecordMetadata(recordId);
            return (recordMetadata.inserted === true);
        }, 
        recordIsUpdated: function(model, recordId)
        {
            let recordMetadata = model.getRecordMetadata(recordId);
            return (recordMetadata.updated === true);
        },   
        recordIsDeleted: function(model, recordId)
        {
            let recordMetadata = model.getRecordMetadata(recordId);
            return (recordMetadata.deleted === true);
        },  
        // get model value             
        getValue: function(model, record, fieldName)
        {
            return model.getValue(record, fieldName);        
        },
        // in case of composite value (value/display value), return the value only
        getScalarValue: function(model, record, fieldName)
        {
            return util.getScalarValue(this.getValue(model, record, fieldName));
        }, 
        getDisplayValue: function(model, record, fieldName)
        {
            return util.getDisplayValue(this.getValue(model, record, fieldName));
        },
        // get the JavaScript value for numbers/dates instead of the model string value
        getNativeValue: function(model, record, fieldName)
        {
            let value = model.getValue(record, fieldName);
            return this.toNativeValue(model, fieldName, value);           
        },
        // setValue
        // use 'suppressFieldChangeHandler' to prevent circular updates
        setValue: function(model, record, fieldName, value = '', suppressFieldChangeHandler = false)
        {
            if (suppressFieldChangeHandler) 
            {
                suppressUtil.suppressField(record, fieldName);
            }
            return model.setValue(record, fieldName, value);
        },
        // setValue, supplying the native JavaScript Value
        setNativeValue(model, record, fieldName, nativeValue, suppressFieldChangeHandler)
        {
            let value = (nativeValue == null || isNaN(nativeValue)) ? '' : this.toFormattedValue(model, fieldName, nativeValue);
            return this.setValue(model, record, fieldName, value, suppressFieldChangeHandler);
        },   
        // for model date/number string values, return the native JavaScript value (parsed value)
        toNativeValue: function(model, fieldName, value)
        {
            let nativeValue = value;
            if (typeof value !== 'object')
            {            
                let modelFields = model.getOption('fields');
                let modelField = modelFields[fieldName];
                let dataType = modelField?.dataType;
                if ((dataType == 'NUMBER' || dataType == 'DATE') && (value == null || value === ''))
                {
                    nativeValue = null;
                }
                else
                {
                    if (dataType == 'NUMBER')
                    {
                        nativeValue = apex.locale.toNumber(value, modelField.formatMask);
                    }
                    else if (dataType == 'DATE')
                    {
                        nativeValue = null;
                        try
                        {
                            nativeValue = apex.date.parse(value, modelField.formatMask);
                        }
                        catch(error) {};
                    } 
                }
            }
            return nativeValue;   
        },
        // for native JavaScript numbers/dates, return formatted value as per format mask
        toFormattedValue: function(model, fieldName, nativeValue)
        {
            let formattedValue = nativeValue;
            if (nativeValue !== '')
            {
                let modelFields = model.getOption('fields');
                let modelField = modelFields[fieldName];
                let dataType = modelField?.dataType;
                if (dataType == 'NUMBER')
                {
                    formattedValue = apex.locale.formatNumber(Number(nativeValue), modelField.formatMask);
                }
                else if (dataType == 'DATE')
                {
                    try
                    {
                        formattedValue = apex.date.format(nativeValue, modelField.formatMask);
                    }
                    catch(error){};                
                }                
            }
            return formattedValue;
        },
        setFieldReadonly: function(model, recordId, fieldName, isReadonly = true)
        {
            let recMetadata = model.getRecordMetadata(recordId);
            let ckCurrentValue = this.getFieldMetaPropertyValue(recMetadata, fieldName, 'ck');
            if (isReadonly && (ckCurrentValue == null || ckCurrentValue == ''))
            {
                this.setFieldMetaPropertyValue(model, recordId, recMetadata, fieldName, 'ck', '1');
            }
            else if (!isReadonly && ckCurrentValue == '1')
            {
                this.deleteFieldMetaProperty(model, recordId, recMetadata, fieldName, 'ck');
            }
        },
        setFieldDisabled: function(model, recordId, fieldName, disabled = true)
        {
            let recMetadata = model.getRecordMetadata(recordId);
            let currentValue = this.getFieldMetaPropertyValue(recMetadata, fieldName, 'disabled');
            if (!((currentValue === null) && !disabled))
            {
                this.setFieldMetaPropertyValue(model, recordId, recMetadata, fieldName, 'disabled', disabled);
            }
        },        
        setFieldHighlight: function(model, recordId, fieldName, hlClass = null)
        {
            let recMetadata = model.getRecordMetadata(recordId);
            let hlCurrentValue = this.getFieldMetaPropertyValue(recMetadata, fieldName, 'highlight');
            // don't interfere with user set highlighting
            if (hlClass !== hlCurrentValue && !util.isUserHighlight(hlCurrentValue))
            {
                if (hlClass)
                {
                    this.setFieldMetaPropertyValue(model, recordId, recMetadata, fieldName, 'highlight', hlClass);
                }
                else
                {
                    this.deleteFieldMetaProperty(model, recordId, recMetadata, fieldName, 'highlight');
                }
            }
        }, 
        setFieldError: function(model, recordId, fieldName, message = '')
        {
            _modelUtil.setFieldMessage(model, recordId, fieldName, 'error', message);
        },   
        setFieldWarning: function(model, recordId, fieldName, message = '')
        {
            _modelUtil.setFieldMessage(model, recordId, fieldName, 'warning', message);
        },     
        fieldHasError: function(model, recordId, fieldName)
        {
            let recMetadata = model.getRecordMetadata(recordId);
            let error = this.getFieldMetaPropertyValue(recMetadata, fieldName, 'error');   
            return (error === true);               
        },
        fieldHasWarning: function(model, recordId, fieldName)
        {
            let recMetadata = model.getRecordMetadata(recordId);
            let warning = this.getFieldMetaPropertyValue(recMetadata, fieldName, 'warning');   
            return (warning === true);               
        },  
        fieldIsReadonly: function(model, recordId, fieldName)
        {
            let recMetadata = model.getRecordMetadata(recordId);
            let ckValue = this.getFieldMetaPropertyValue(recMetadata, fieldName, 'ck');
            return (ckValue != null && ckValue != '');
        },
        fieldIsDisabled: function(model, recordId, fieldName)
        {
            let recMetadata = model.getRecordMetadata(recordId);
            let disabled = this.getFieldMetaPropertyValue(recMetadata, fieldName, 'disabled');
            return (disabled === true);
        },   
        // fieldIsWritable
        // a field is writable when it is not read only/disabled/record protected
        // returns an object {writable: boolean, reason: string}
        fieldIsWritable: function(model, recordId, fieldName)
        {
            let record = model.getRecord(recordId);
            let recMetadata = model.getRecordMetadata(recordId);
            let result = {writable: true};
            if (!model.allowEdit(record))
            {
                result.writable = false;
                result.reason = 'RECORD_PROTECTED';
            }
            else if (this.fieldIsReadonly(model, recordId, fieldName))
            {
                result.writable = false;
                result.reason = 'FIELD_READONLY';                    
            }
            else if (this.fieldIsDisabled(model, recordId, fieldName))
            {
                result.writable = false;
                result.reason = 'FIELD_DISABLED';                      
            }
            return result;        
        },   
        // fieldHasChanged
        // as per record field metadata, which indicates in fact if the field is dirty      
        // so a change or changes were applied
        // when after changes the value has become equal to the original value, still this meta flag will be true
        fieldHasChanged: function(model, recordId, fieldName)
        {
            let recMetadata = model.getRecordMetadata(recordId);
            let changed = this.getFieldMetaPropertyValue(recMetadata, fieldName, 'changed');   
            return (changed === true);         
        },
        // revert all changes in the model
        revertAll: function(model)
        {
            let changes = model.getChanges();
            if (changes.length > 0)
            {
                model.revertRecords(changes.filter((recMeta)=>recMeta.updated||recMeta.deleted).map((recMeta) => recMeta.record));
                model.deleteRecords(changes.filter((recMeta)=>recMeta.inserted).map((recMeta) => recMeta.record)); 
            }            
        }, 
        //           
        getFieldMetadata: function(recMetadata, fieldName, createIfNotExists)
        {
            let result = null;
            if (recMetadata) {
                let fields = recMetadata.fields || (createIfNotExists ? recMetadata.fields = {} : null);
                if (fields) {
                    result = fields[fieldName] || (createIfNotExists ? fields[fieldName] = {} : null);
                }
            }           
            return result;           
        },
        getFieldMetaPropertyValue: function(recMetadata, fieldName, metaProperty)
        {
            let result = null;
            let fieldMetadata = this.getFieldMetadata(recMetadata, fieldName, false);
            if (fieldMetadata)
            {
                result = fieldMetadata[metaProperty];
            }
            return result;
        },        
        setFieldMetaPropertyValue: function(model, recordId, recMetadata, fieldName, metaProperty, value)
        {
            if (recMetadata)
            {
                let fieldMeta = (recMetadata.fields ||= {})[fieldName] ||= {};  
                fieldMeta[metaProperty] = value;         
                model.metadataChanged(recordId, fieldName, metaProperty); 
            } 
        },
        deleteFieldMetaProperty: function(model, recordId, recMetadata, fieldName, metaProperty)
        {
            if (recMetadata)
            {
                let fieldsMetadata = recMetadata.fields;
                if (fieldsMetadata)
                {
                    if (fieldsMetadata[fieldName] && fieldsMetadata[fieldName][metaProperty])
                    {
                        delete fieldsMetadata[fieldName][metaProperty];
                        model.metadataChanged(recordId, fieldName, metaProperty);
                    }
                }
            } 
        },
        // recordArrayToObject
        // records are kept as arrays in the model
        // this method derives the record data as an object with properties reflecting all record fields
        recordArrayToObject: function(model, record)
        {
            let recordObject = null;
            let modelFields = model.getOption('fields');
            if (record && modelFields)
            {
                recordObject = {};
                for (const [fieldName, modelField] of Object.entries(modelFields))
                {  
                    if (this.isRecordField(model, modelField))
                    {
                        recordObject[fieldName] = model.getValue(record, fieldName);
                    }
                }
            }
            return recordObject;
        },
        // isRecordField
        // will be false in case of metaFields which are fields for internal model administration
        // so can be used to restrict the set of record fields to purely functional record fields
        isRecordField: function(model, modelField)
        {
            return (modelField.hasOwnProperty('index') && modelField.property != model.getOption('metaField')); 
        }                    
    }

    // modelUtil methods not externally exposed
    let _modelUtil = {
        // method used for both setting error/warning messages
        setRecordMessage: function(model, recordId, validity, message)
        {
            if (message)
            {
                model.setValidity(validity, recordId, null, message);
            }
            else
            {
                model.setValidity('valid', recordId);
            }
        },        
        setFieldMessage: function(model, recordId, fieldName, validity, message)
        {
            if (message)
            {
                model.setValidity(validity, recordId, fieldName, message);
                // in case the record is active, the _setModelValue() function in tableModelViewBase.js will 
                // overrule the validity with the validity as determined from columnItem (columnItem.getValidationMessage())
                // from which the above setValidity is effectively undone
                // in below code we rectify this. The above 'setValidity' is still also needed as without, 
                // a view like Spreadsheet View will miss it because of the below timeout
                let igStaticId = model.getOption(regionIdPropertyName);
                if (igStaticId)
                {
                    let gridView = apex.region(igStaticId).call('getViews').grid;
                    if (gridView)
                    {
                        let activeRecordId = gridView.view$.grid('getActiveRecordId');
                        if (recordId == activeRecordId)
                        {
                            setTimeout(() => {
                                // check if not current error/warning (which might happen from columnItem)
                                // if column item validity is valid, APEX will have set the validity in the model also to valid
                                if (!modelUtil.fieldHasError(model, recordId, fieldName) && !modelUtil.fieldHasWarning(model, recordId, fieldName))
                                {
                                    model.setValidity(validity, recordId, fieldName, message);
                                }
                            });
                        }
                    }
                }                
            }
            else
            {
                model.setValidity('valid', recordId, fieldName);
            }
        },
        // check if none of the record fiels have the error flag set as true
        recordFieldsValid: function(model, recordId)
        {
            const fields = model.getRecordMetadata(recordId)?.fields;
            return !Object.values(fields || {}).some(f => f.error);              
        }        
    }

    // some util methods to support suppressing the 'onChangeField' handler
    let suppressUtil = {
        suppressField: function(record, fieldName) 
        {
            let fields = suppressionMap.get(record);
            if (!fields) 
            {
                fields = new Set();
                suppressionMap.set(record, fields);
            }
            fields.add(fieldName);
        },
        isSuppressed: function(record, fieldName) 
        {
            let fields = suppressionMap.get(record);
            return fields && fields.has(fieldName);
        },
        clearSuppression: function(record, fieldName)
        {
            let fields = suppressionMap.get(record);
            if (fields)
            {
                fields.delete(fieldName);
                if (fields.size === 0) 
                {
                    suppressionMap.delete(record);
                }
            }
        }          
    }

    // logUtil methods
    // can be used development time to inspect model data+metadata in browser console
    // main method is logModel()
    let logUtil = {
        // options properties used to filter: model, regionId, recordId, index (record index), changesOnly
        // use model or regionId to denote the model to use
        // use recordId or index to show just one record or skip to show all (index is zero based)
        // use changesOnly to restrict to changed records only
        logModel: function(options)
        {
            if (options == 'help')
            {
                console.log('{model|regionId, [recordId|index], [changesOnly]}');
                return;
            }
            let model = options.model;
            if (options.regionId)
            {
                model = apex.region(options.regionId).call('getViews').grid.model;
            }
            let recordId = options.recordId;
            if (options.hasOwnProperty('index'))
            {
                let record = model.recordAt(options.index);
                if (record)
                {
                    recordId = model.getRecordId(model.recordAt(options.index));
                }
            }
            if (recordId)
            {
                this.logRecord(model, recordId);
            }
            else
            {
                this.logRecords(model, options.changesOnly);
            }
            return model;
        },
        logRecords: function(model, changesOnly)
        {
            let itr = changesOnly ? model.getChanges().map(meta => meta.record) : model;
            itr.forEach(function(record){
                logUtil.logRecord(model, model.getRecordId(record));
            });
        },
        logRecord: function(model, recordId)
        {
            let record = model.getRecord(recordId);
            console.log(recordId, {
                record: record,
                recordObject: modelUtil.recordArrayToObject(model, record),
                meta: model.getRecordMetadata(recordId)
            });
        },
    
    }

    // general util methods
    let util = {
        // check if highlight value indicates a highlight was user defined
        isUserHighlight: function(value) {
            // user highlight will have value like: "5437485345594756"
            return typeof value === "string" && /^\d+$/.test(value);
        },
        // in case of composite value (value + display value), return value only
        getScalarValue: function(value)
        {
            if (value !== null && typeof value === "object" && value.hasOwnProperty( "v" ))
            {
                value = value.v;
            }
            return value;
        },  
        getDisplayValue: function(value)
        {
            if (value !== null && typeof value === "object" && value.hasOwnProperty( "d" ))
            {
                value = value.d;
            }
            return value;
        },
        valueIsString: function(value)
        {
            return (typeof value === 'string' || value instanceof String);
        }         
    }

    // module as to hook into relevant models 
    // supporting 'onEvaluateRecord', 'onFieldChange', 'onSetAggregateValue',
    // onInitCalcValue and onInitCheckCallback handlers
    // a context (ctx) object will be passed to the handlers with 
    // model/record/recordId properties and the ctx object prototype will make 
    // the util methods available 
    let modelModule = (function() {
        apex.gPageContext$.on("interactivegridviewmodelcreate", function(jQueryEvent, data){  
            // check if handlers are registered for the IG
            let igStaticId = data.model.getOption(regionIdPropertyName);
            if (ig_ml_eventHandlers.hasOwnProperty(igStaticId))
            {
                let model = data.model;
                // in case 'Lazy loading' is off, there can be records already on 
                // load of the page, so we evaluate them here
                evaluateRecords(model, null, 'addData');
                model.subscribe({
                    onChange: function(changeType, change) {
                        if (change)
                        {
                            // evaluateRecords as per next moments
                            // 'endRecordEdit' moment will be added later
                            if (['addData', 'refreshRecords', 'revert', 'insert', 'copy'].includes(changeType))
                            {   
                                // compose array of records to be evaluated
                                let records = null;
                                if (change.records)
                                {
                                    records = change.records;
                                }
                                else if (change.record)
                                {
                                    records = [change.record];
                                }
                                else
                                {
                                    records = [];
                                    if (change.hasOwnProperty('offset') && change.hasOwnProperty('count'))
                                    {
                                        model.forEachInPage(change.offset, change.count, function( record, index, id ) {
                                            if (record)
                                            {
                                                records.push(record);
                                            }
                                        });
                                    }
                                    if (change.replacedIds)
                                    {
                                        change.replacedIds.forEach(function(recordId) {
                                            let record = model.getRecord(recordId);
                                            if (record)
                                            {
                                                records.push(record);
                                            }
                                        });
                                    }
                                }
                                if (records && records.length > 0)
                                {
                                    evaluateRecords(model, records, changeType);
                                }
                            }
                            // onFieldChange / onSetAggregateValue
                            else if (changeType == 'set')
                            {
                                let recordMetadata = model.getRecordMetadata(change.recordId);
                                if (recordMetadata.agg)
                                {
                                    // in case an aggregate is defined in the 'Column Initialization JavaScript Function', 
                                    // there will be a 'set' notification
                                    onSetAggregateValue(model, change, recordMetadata);
                                }
                                else if (!recordMetadata?.deleted)   // deleted shouldn't happen; just to be sure
                                {
                                    if (suppressUtil.isSuppressed(change.record, change.field)) 
                                    {
                                        suppressUtil.clearSuppression(change.record, change.field);
                                    }
                                    else
                                    {                                        
                                        onFieldChange(model, change);
                                    }
                                }
                            }
                        }
                    }
                });
            }
        });  

        // context object prototype with util methods
        let ctxPrototype = 
        {
            getOriginalRecord: function()
            {
                return modelUtil.getOriginalRecord(this.model, this.recordId);
            },
            setRecordHighlight: function(hlClass)
            {
                modelUtil.setRecordHighlight(this.model, this.recordId, hlClass);
            },
            setRecordError: function(message)
            {
                modelUtil.setRecordError(this.model, this.recordId, message);
            },
            setRecordWarning: function(message)
            {
                modelUtil.setRecordWarning(this.model, this.recordId, message);
            },  
            setRecordHidden: function(hidden)
            {
                modelUtil.setRecordHidden(this.model, this.recordId, hidden);
            },
            setRecordDisabled: function(disabled)
            {
                modelUtil.setRecordDisabled(this.model, this.recordId, disabled);
            },            
            recordHasError: function()
            {
                return modelUtil.recordHasError(this.model, this.recordId);
            },
            recordHasWarning: function()
            {
                return modelUtil.recordHasWarning(this.model, this.recordId);
            },    
            recordIsValid: function()
            {
                return modelUtil.recordIsValid(this.model, this.recordId);
            },       
            getRecordStatus: function()
            {
                return modelUtil.getRecordStatus(this.model, this.recordId);
            },  
            recordIsNew: function()
            {
                return modelUtil.recordIsNew(this.model, this.recordId);
            },     
            recordIsUpdated: function()
            {
                return modelUtil.recordIsUpdated(this.model, this.recordId);
            },   
            recordIsDeleted: function()
            {
                return modelUtil.recordIsDeleted(this.model, this.recordId);
            },                                   
            getValue: function(fieldName = this.fieldName)
            {
                return modelUtil.getValue(this.model, this.record, fieldName);
            },
            getScalarValue: function(fieldName = this.fieldName)
            {
                return modelUtil.getScalarValue(this.model, this.record, fieldName);
            },   
            getDisplayValue: function(fieldName = this.fieldName)
            {
                return modelUtil.getDisplayValue(this.model, this.record, fieldName);
            },                     
            getNativeValue: function(fieldName = this.fieldName)
            {
                return modelUtil.getNativeValue(this.model, this.record, fieldName);
            },
            setValue: function(fieldName, value, suppressFieldChangeHandler)
            {
                fieldName ??= this.fieldName;               
                return modelUtil.setValue(this.model, this.record, fieldName, value, suppressFieldChangeHandler);
            },
            setNativeValue: function(fieldName, nativeValue, suppressFieldChangeHandler)
            {
                fieldName ??= this.fieldName;
                return modelUtil.setNativeValue(this.model, this.record, fieldName, nativeValue, suppressFieldChangeHandler);
            },            
            setFieldReadonly: function(fieldName, isReadonly)
            {
                fieldName ??= this.fieldName;
                modelUtil.setFieldReadonly(this.model, this.recordId, fieldName, isReadonly);
            },
            setFieldDisabled: function(fieldName, disabled)
            {
                fieldName ??= this.fieldName;
                modelUtil.setFieldDisabled(this.model, this.recordId, fieldName, disabled);
            },            
            setFieldHighlight: function(fieldName, hlClass)
            {
                fieldName ??= this.fieldName;
                modelUtil.setFieldHighlight(this.model, this.recordId, fieldName, hlClass);
            },
            setFieldError: function(fieldName, message)
            {
                fieldName ??= this.fieldName;
                modelUtil.setFieldError(this.model, this.recordId, fieldName, message);
            },
            setFieldWarning: function(fieldName, message)
            {
                fieldName ??= this.fieldName;
                modelUtil.setFieldWarning(this.model, this.recordId, fieldName, message);
            },
            fieldHasError: function(fieldName = this.fieldName)
            {
                return modelUtil.fieldHasError(this.model, this.recordId, fieldName);
            },
            fieldHasWarning: function(fieldName = this.fieldName)
            {
                return modelUtil.fieldHasWarning(this.model, this.recordId, fieldName);
            },            
            fieldHasChanged: function(fieldName = this.fieldName)
            {
                return modelUtil.fieldHasChanged(this.model, this.recordId, fieldName);
            },
            fieldIsReadonly: function(fieldName = this.fieldName)
            {
                return modelUtil.fieldIsReadonly(this.model, this.recordId, fieldName);
            },
            fieldIsDisabled: function(fieldName = this.fieldName)
            {
                return modelUtil.fieldIsDisabled(this.model, this.recordId, fieldName);
            },                   
            fieldIsWritable: function(fieldName = this.fieldName)
            {
                return modelUtil.fieldIsWritable(this.model, this.recordId, fieldName);
            },
            // some methods are on a more general level
            util: {
                toNativeValue: modelUtil.toNativeValue,
                toFormattedValue: modelUtil.toFormattedValue,
                getFieldMetadata: modelUtil.getFieldMetadata,
                getFieldMetaPropertyValue: modelUtil.getFieldMetaPropertyValue,
                setFieldMetaPropertyValue: modelUtil.setFieldMetaPropertyValue,
                deleteFieldMetaProperty: modelUtil.deleteFieldMetaProperty
            }
        };

        // evaluate all given records, triggering 'onEvaluateRecord' for each
        // reason reflects what was triggering the evaluate: addData, refreshRecords, endRecordEdit, etc
        function evaluateRecords(model, records, reason)
        {
            let igStaticId = model.getOption(regionIdPropertyName);
            let ctx = Object.create(ctxPrototype);
            ctx.model = model;
            ctx.reason = reason;
            let itr = records ? records : model;
            itr.forEach(function (record){
                ctx.recordId = model.getRecordId(record);
                let recordMetadata = model.getRecordMetadata(ctx.recordId);
                if (recordMetadata)
                {
                    if (!recordMetadata.agg && !recordMetadata.deleted)     // deleted ones shouldn't happen; just to be sure
                    {
                        ctx.record = record;
                        fireMuEvent(igStaticId, 'onEvaluateRecord', ctx.recordId, ctx);
                    }
                    else if (recordMetadata.agg)
                    {
                        // in case the aggregate definition is from the Actions menu, so part of the report,
                        // then the aggregate value is determined server-side, and there is no corresponding 
                        // 'set' notification. The aggregate row in this scenario will be part of the returned
                        // model data where recordMetadata.agg is having the aggregate function name.
                        // So we can check here the record for non-empty field values and fire the onSetAggregateValue.
                        let modelFields = model.getOption('fields');
                        if (modelFields)
                        {
                            for (const [fieldName, modelField] of Object.entries(modelFields))
                            {  
                                if (modelUtil.isRecordField(model, modelField))
                                {     
                                    let fieldValue = model.getValue(record, fieldName);
                                    if (fieldValue)
                                    {
                                        let change = {
                                            recordId: model.getRecordId(record),
                                            record: record,
                                            field: fieldName
                                        };
                                        onSetAggregateValue(model, change, recordMetadata);
                                    }
                                }
                            }
                        }                   
                    }
                }
            });
        };    
        
        // trigger 'onFieldChange' handler with ctx context object
        function onFieldChange(model, change)
        {
            let igStaticId = model.getOption(regionIdPropertyName);            
            let ctx = Object.create(ctxPrototype);
            ctx.model = model;
            ctx.recordId = change.recordId;
            ctx.record = change.record;
            ctx.fieldName = change.field;
            ctx.oldValue = change.oldValue;
            // when a calcValue is configured, APEX is having a strange behavior in which the 'set' notification
            // is fired twice. The first time the model record has the new value as a number instead of a string. The
            // second time the model record has the correct string value (formatted) - the old value in the notification here
            // is the number value as set before. Below code is fixing the situation by formatting the value in case a number
            // is detected, and it also reduces to one event.
            if (!util.valueIsString(ctx.oldValue))
            {
                ctx.oldValue = ctx.util.toFormattedValue(model, ctx.fieldName, ctx.oldValue);
            }
            ctx.newValue = model.getValue(change.record, change.field);
            if (!util.valueIsString(ctx.newValue))
            {
                ctx.newValue = ctx.util.toFormattedValue(model, ctx.fieldName, ctx.newValue);
            }            
            if (change.oldIdentity)
            {
                ctx.oldIdentity = change.oldIdentity;
            }
            if (ctx.newValue !== ctx.oldValue)
            {
                fireMuEvent(igStaticId, 'onFieldChange', ctx.fieldName, ctx);
            }
        }

        // trigger 'onSetAggregateValue' handler with ctx context object
        // In case an aggregate is defined in 'Column Initialization JavaScript Function', 
        // the aggregate value is calculated in the model by APEX upon moments like data load, model changes and
        // upon save. All those moments will trigger a 'set' notification.
        // In case an aggregate is defined from the Actions menu, the aggregate is calculated server-side. There
        // will be no 'set' notification, but the record will be part of 'addData'. So via evaluateRecords, 
        // onSetAggregateValue will be triggered in this second scenario.
        function onSetAggregateValue(model, change, recordMetadata)
        {
            let igStaticId = model.getOption(regionIdPropertyName);            
            let ctx = Object.create(ctxPrototype);
            ctx.model = model;
            ctx.recordId = change.recordId;
            ctx.record = change.record;
            ctx.fieldName = change.field;
            ctx.aggregateFunction = recordMetadata.agg;
            ctx.isGrandTotal = recordMetadata.grandTotal;
            fireMuEvent(igStaticId, 'onSetAggregateValue', ctx.aggregateFunction + ' ' + ctx.fieldName, ctx);
        }        
        
        // get event handler as registered 
        function getEventHandler(igStaticId, handlerName)
        {
            let result = null;
            if (ig_ml_eventHandlers.hasOwnProperty(igStaticId))
            {
                let eventHandlers = ig_ml_eventHandlers[igStaticId];
                if (typeof eventHandlers[handlerName] === 'function')     
                {
                    result = eventHandlers[handlerName];
                }   
            }
            return result;    
        }

        function fireMuEvent(igStaticId, name, key, ctx)
        {
            apex.debug.trace('lib4x-event (IG-ML): ', name, key, ctx);
            getEventHandler(igStaticId, name)?.(ctx);
        }       

        // to trigger 'onInitCalcValue' and 'onInitCheckCallback', initModel
        // must be called from IG/attributes/JS Initialization function, just before 'return options;'
        // potentially, we could also have a 'onInitVisibilityFilter', however not really required as 
        // in onEvaluateRecord, records can be set to hidden
        function initModel(igOptions)
        {
            let igStaticId = igOptions[regionIdPropertyName];
            initCheckCallback(igStaticId, igOptions);
            for (const columnOptions of igOptions.columns) {
                if (!columnOptions.hasOwnProperty('specialType'))
                {
                    initCalcValue(igStaticId, columnOptions);
                }
            }   
        }

        // initCalcValue
        // Example handler:
        //        onInitCalcValue: function(initCtx)
        //        {
        //            if (initCtx.columnName == 'LINETOTAL')
        //            {
        //                initCtx.setCalcValue('SAL', 'COMM', function(calcCtx){
        //                    let lineTotal = calcCtx.getNativeValue('AMOUNT') + calcCtx.getNativeValue('VAT');
        //                    return isNaN(lineTotal) ? 0 : lineTotal;
        //                });
        //           }
        //        }
        // this construct enables to have all model logic in one place and the handler will have access to
        // the model util methods
        function initCalcValue(igStaticId, options)
        {                    
            let ctx = {
                columnName: options.name,
                dataType: options.dataType,                
                isReadOnly: options.isReadOnly
            }
            if (options.dataType == 'NUMBER' || options.dataType == 'DATE')
            {
                ctx.formatMask = options.appearance?.formatMask;
            }
            // args: 0, 1 or more 'dependsOn' args + calcValue function arg
            ctx.setCalcValue = function(...args)
            {
                let calcValueFunc = args.pop();
                let dependsOn = args.flat().filter(v => typeof v === 'string');
                if (!options.hasOwnProperty('defaultGridColumnOptions'))
                {
                    options.defaultGridColumnOptions = {};
                }      
                let columnOptions = options.defaultGridColumnOptions;                 
                let existing = Array.isArray(columnOptions.dependsOn) ? columnOptions.dependsOn : [];
                columnOptions.dependsOn = [...new Set([...existing, ...dependsOn])];
                columnOptions.calcValue = function(argsArray, model, record) {
                    let ctx = Object.create(ctxPrototype);
                    ctx.argsArray = argsArray;
                    ctx.model = model;
                    ctx.record = record;
                    return calcValueFunc(ctx);
                };
            },
            fireMuEvent(igStaticId, 'onInitCalcValue', options.name, ctx);
        }

        // the check callback can be used to do additional access checking
        // see https://docs.oracle.com/en/database/oracle/apex/24.2/aexjs/model.html#.CheckCallback
        function initCheckCallback(igStaticId, igOptions)
        {     
            let ctx = {};               
            ctx.setCheckCallback = function(checkCallback)
            {
                if (!igOptions.hasOwnProperty('defaultModelOptions'))
                {
                    igOptions.defaultModelOptions = {};
                }      
                let modelOptions = igOptions.defaultModelOptions;                 
                modelOptions.check = function(result, operation, record, addAction, recordsToAdd) {
                    let ctx = Object.create(ctxPrototype);
                    ctx.model = apex.region(igStaticId).call('getViews').grid.model;
                    ctx.result = result;
                    ctx.operation = operation;
                    ctx.record = record;
                    ctx.addAction = addAction;
                    ctx.recordsToAdd = recordsToAdd;
                    return checkCallback(ctx);
                };
            },
            fireMuEvent(igStaticId, 'onInitCheckCallback', '', ctx);
        }     
        
        /*function initVisibilityFilter(igStaticId, igOptions)
        {     
            let ctx = {};               
            ctx.setVisibilityFilter = function(visibilityFilter)
            {
                if (!igOptions.hasOwnProperty('defaultModelOptions'))
                {
                    igOptions.defaultModelOptions = {};
                }      
                let modelOptions = igOptions.defaultModelOptions;                 
                modelOptions.visibilityFilter = function(model, record, visibilityFilterContext) {
                    let ctx = Object.create(ctxPrototype);
                    ctx.model = model;
                    ctx.recordId = model.getRecordId(record);
                    ctx.record = record;
                    return visibilityFilter(ctx);
                };
                // no need for visibilityFilterContext as the context can be created in the onInitVisibilityFilter
                // still we have to set it as else, APEX won't call visibilityFilter
                modelOptions.visibilityFilterContext = {};
            },
            fireMuEvent(igStaticId, 'onInitVisibilityFilter', '', ctx);
        }*/         
        
        return {
            evaluateRecords: evaluateRecords,
            initModel: initModel
        }
    })();

    const [apexMajorVersion, apexMinorVersion, apexPatchVersion] = apex.env.APEX_VERSION.split(".").map(Number);
    regionIdPropertyName = apexMajorVersion >= 26 ? 'regionDomId' : 'regionStaticId';    

    // subscribe to 'apexendrecordedit' / 'lib4xendrecordedit' events for triggering record evaluation
    // 'lib4xendrecordedit' is thrown by lib4x plugins: IG Spreadsheet View, Exec Server-Side IG Row Logic
    apex.gPageContext$.on('apexreadyend', function(jQueryEvent) {
        Object.keys(ig_ml_eventHandlers).forEach(function(igStaticId) {
            $('#' + igStaticId).on('apexendrecordedit lib4xendrecordedit', function(jQueryEvent, data) {
                let records = data?.records ?? (data?.record ? [data.record] : null);
                if (records) {
                    modelModule.evaluateRecords(data.model, records, 'endRecordEdit');
                }
            });
        });          
    });

    // DA main method
    let init = function()
    {
        // nothing to init here though - init is done on apex events (model creation/apexreadyend)
    }

    // external interface
    window.lib4x = window.lib4x || {};
    lib4x.ig = lib4x.ig || {};
    lib4x.ig.modelLogic = lib4x.ig.modelLogic || {};

    lib4x.ig.modelLogic.registerHandlers = function(igStaticId, eventHandlers) {
        ig_ml_eventHandlers[igStaticId] = eventHandlers;
    };
    lib4x.ig.modelLogic.unregisterHandlers = function(igStaticId) {
        delete ig_ml_eventHandlers[igStaticId];
    };  
    // init function enabling 'onInitCalcValue' and 'onInitCheckCallback'
    // call from IG/Attributes/JS Initialization function (just before 'return options;')
    lib4x.ig.modelLogic.init = function(igOptions)
    {
        modelModule.initModel(igOptions);
    };
    lib4x.ig.modelLogic.util = modelUtil;
    lib4x.ig.modelLogic.logging = logUtil;

    return {
        _init: init,
    }    
})(apex.jQuery);
